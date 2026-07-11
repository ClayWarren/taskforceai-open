use std::env;
use std::time::{Duration, Instant};

use crossterm::event::{Event as CrosstermEvent, EventStream};
use futures_util::{stream::FuturesUnordered, StreamExt};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use taskforceai_app_client::{AppClientError, AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::{
    AppServerEvent, HistoryListParams, PromptQueueDispatchAfterResponseParams, QuickModeSetParams,
    RunIDParams, RunModeSetParams, RunStatus, SubmitRunParams,
};
use tokio::task::JoinHandle;
use tokio::time;

use crate::input::{map_key_event_with_keyboard_enhancement, map_mouse_event, InputAction};
use crate::state::{AppState, FocusArea, UiAction};
use crate::ui;
use crate::update;
use crate::voice;

mod commands;
pub(crate) mod format;
mod polling;

use commands::{format_realtime_voice_result, handle_local_command, transcribe_voice_ui_action};
use polling::{poll_login_if_due, poll_sync_if_due, replay_pending_prompt_if_due};

pub(super) type UiTaskQueue = FuturesUnordered<JoinHandle<BackgroundTaskResult>>;

pub(super) enum BackgroundTaskResult {
    Ui(Box<UiAction>),
    RealtimeVoice(Result<voice::RealtimeTurnResult, voice::VoiceError>),
}

// coverage:ignore-start -- live terminal event loop is exercised by TUI smoke tests.
pub async fn run_event_loop(
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
) -> Result<(), AppClientError> {
    let mut reader = EventStream::new();
    let mut tick = time::interval(Duration::from_millis(250));
    let mut startup_hydrated = false;
    let mut startup_update = startup_update_task();
    let mut background_tasks: UiTaskQueue = FuturesUnordered::new();
    let mut space_dictation = SpaceDictationState::Idle;

    while !state.should_quit {
        terminal
            .draw(|frame| ui::render(frame, state))
            .map_err(AppClientError::Read)?;

        tokio::select! {
            maybe_event = reader.next() => {
                if let Some(Ok(event)) = maybe_event {
                    let action = match event {
                        CrosstermEvent::Key(key) => map_key_event_with_keyboard_enhancement(
                            key,
                            keyboard_enhancement_enabled,
                        ),
                        CrosstermEvent::Mouse(mouse) => map_mouse_event(mouse),
                        _ => None,
                    };
                    if let Some(action) = action {
                        let size = terminal.size().map_err(AppClientError::Read)?;
                        let area = Rect {
                            x: 0,
                            y: 0,
                            width: size.width,
                            height: size.height,
                        };
                        if let Err(err) =
                            handle_input_action(
                                client,
                                state,
                                action,
                                area,
                                &mut background_tasks,
                                &mut space_dictation,
                            ).await
                        {
                            apply_interactive_error(state, err);
                        }
                    }
                }
            }
            maybe_result = background_tasks.next(), if !background_tasks.is_empty() => {
                if let Some(result) = maybe_result {
                    match result {
                        Ok(result) => apply_background_task_result(state, result),
                        Err(err) => {
                            state.apply(UiAction::CommandOutputDisplayed {
                                title: "Task".to_string(),
                                message: format!("Background task failed: {err}"),
                            });
                        }
                    }
                }
            }
            maybe_event = client.next_event() => {
                let Some(event) = maybe_event? else {
                    return Err(AppClientError::Closed);
                };
                let after_response_conversation_id = after_response_conversation_id(&event);
                state.apply(UiAction::ServerEvent(event));
                if let Some(conversation_id) = after_response_conversation_id {
                    match client
                        .prompt_queue_dispatch_after_response(
                            PromptQueueDispatchAfterResponseParams {
                                conversation_id: Some(conversation_id),
                            },
                        )
                        .await
                    {
                        Ok(result) if result.dispatched => {
                            state.status_line = result.message;
                        }
                        Ok(_) => {}
                        Err(err) => apply_interactive_error(state, err),
                    }
                }
            }
            _ = tick.tick() => {
                state.apply(UiAction::Tick);
                start_space_dictation_if_due(state, &mut space_dictation);
                if !startup_hydrated {
                    hydrate_startup_state(client, state).await;
                    startup_hydrated = true;
                    continue;
                }
                if let Some(update) = &startup_update {
                    if update.is_finished() {
                        apply_finished_startup_update(state, startup_update.take()).await;
                        continue;
                    }
                }
                if !background_tasks.is_empty() {
                    continue;
                }
                if let Err(err) = poll_login_if_due(client, state).await {
                    apply_interactive_error(state, err);
                }
                if let Err(err) = poll_sync_if_due(client, state).await {
                    apply_interactive_error(state, err);
                }
                if let Err(err) = replay_pending_prompt_if_due(client, state).await {
                    apply_interactive_error(state, err);
                }
            }
        }
    }

    if let Some(update) = startup_update {
        update.abort();
    }

    Ok(())
}
// coverage:ignore-end

fn apply_background_task_result(state: &mut AppState, result: BackgroundTaskResult) {
    match result {
        BackgroundTaskResult::Ui(action) => state.apply(*action),
        BackgroundTaskResult::RealtimeVoice(result) => {
            let (title, message) = format_realtime_voice_result(result);
            state.apply(UiAction::CommandOutputDisplayed { title, message });
        }
    }
}

async fn hydrate_startup_state(client: &mut AppServerClient, state: &mut AppState) {
    match client.status_summary().await {
        Ok(status) => {
            state.set_authenticated(status.authenticated);
            state.set_current_model(status.model_id);
            state.apply(UiAction::PetUpdated(status.pet));
        }
        Err(err) => apply_interactive_error(state, err),
    }
    match client.history_list(HistoryListParams { limit: 50 }).await {
        Ok(history) => state.apply(UiAction::HistoryLoaded(history.runs)),
        Err(err) => apply_interactive_error(state, err),
    }
}

// coverage:ignore-start -- starts a background live release check.
fn startup_update_task() -> Option<JoinHandle<StartupUpdateResult>> {
    if update::auto_update_disabled_reason().is_some() {
        return None;
    }
    Some(tokio::spawn(async {
        startup_update_result(
            update::check_for_update_ignoring_opt_in(env!("CARGO_PKG_VERSION")).await,
        )
        .await
    }))
}
// coverage:ignore-end

async fn apply_finished_startup_update(
    state: &mut AppState,
    update: Option<JoinHandle<StartupUpdateResult>>,
) {
    let Some(update) = update else {
        return;
    };
    match update.await {
        Ok(result) => {
            state.command_output = result.command_output;
            state.status_line = result.status_line;
        }
        Err(err) => {
            state.command_output = Some(format!("Update\nAuto-update task failed: {err}"));
            state.status_line = "Auto-update failed".to_string();
        }
    }
}

async fn startup_update_result(
    check: Result<Option<update::UpdateCheck>, update::UpdateError>,
) -> StartupUpdateResult {
    match check {
        Ok(Some(check)) => {
            let latest_version = check.latest_version.clone();
            match update::apply_update(&check).await {
                // coverage:ignore-start -- requires a successful live self-update application.
                Ok(()) => StartupUpdateResult {
                    command_output: Some(format!(
                        "Update\nUpdated to {latest_version}. Restart TaskForceAI to use the new version."
                    )),
                    status_line: "Updated TaskForceAI; restart to complete".to_string(),
                },
                // coverage:ignore-end
                Err(err) => StartupUpdateResult {
                    command_output: Some(format!("Update\nAuto-update failed: {err}")),
                    status_line: "Auto-update failed".to_string(),
                },
            }
        }
        Ok(None) => StartupUpdateResult {
            command_output: None,
            status_line: "Connected to app-server; already on latest version".to_string(),
        },
        Err(err) => StartupUpdateResult {
            command_output: Some(format!("Update\nAuto-update check failed: {err}")),
            status_line: "Auto-update check failed".to_string(),
        },
    }
}

struct StartupUpdateResult {
    command_output: Option<String>,
    status_line: String,
}

enum SpaceDictationState {
    Idle,
    Pending {
        started_at: Instant,
        space_index: usize,
    },
    Recording {
        recording: voice::ActiveRecording,
    },
}

const SPACE_DICTATION_HOLD_THRESHOLD: Duration = Duration::from_millis(300);

fn apply_interactive_error(state: &mut AppState, err: AppClientError) {
    let message = match err {
        AppClientError::Rpc { code, message } => {
            format!("Request failed ({code}): {message}")
        }
        other => other.to_string(),
    };
    state.command_output = Some(format!("Error\n{message}"));
    state.model_selector = None;
    state.status_line = "Command failed".to_string();
}

async fn handle_input_action(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
    terminal_area: Rect,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    match action {
        InputAction::Quit => {
            if state.effort_selector_active() {
                state.apply(UiAction::EffortSelectorClosed);
            } else if state.model_selector_active() {
                state.apply(UiAction::ModelSelectorClosed);
            } else {
                state.apply(UiAction::QuitRequested);
            }
        }
        InputAction::ToggleFocus => state.apply(UiAction::ToggleFocus),
        InputAction::ToggleSidebar => state.apply(UiAction::ToggleSidebar),
        InputAction::ToggleQuickMode => toggle_quick_mode(client, state).await?,
        InputAction::ToggleAutonomousMode => toggle_autonomous_mode(client, state).await?,
        InputAction::ToggleComputerUseMode => toggle_computer_use_mode(client, state).await?,
        InputAction::SubmitPrompt => {
            if state.effort_selector_active() {
                let effort = state.selected_effort().map(ToOwned::to_owned);
                state.apply(UiAction::ReasoningEffortSet(effort));
                return Ok(());
            }
            if state.model_selector_active() {
                select_highlighted_model(client, state).await?;
                return Ok(());
            }
            if state.focus == FocusArea::Runs && state.prompt_input.trim().is_empty() {
                state.apply(UiAction::LoadSelectedRunIntoPrompt);
                return Ok(());
            }
            state.accept_selected_command_suggestion();
            let prompt = state.prompt_input.trim().to_string();
            if prompt.is_empty() {
                state.apply(UiAction::PromptSubmitRejected);
                return Ok(());
            }
            if prompt.starts_with('/') {
                handle_local_command(client, state, &prompt, background_tasks).await?;
                return Ok(());
            }
            if !local_runs_allowed() {
                let auth = client.auth_status().await?;
                state.set_authenticated(auth.authenticated);
                if !auth.authenticated {
                    state.apply(UiAction::CommandExecuted {
                        title: "Login Required".to_string(),
                        message: "Not authenticated. Use /login first.".to_string(),
                    });
                    return Ok(());
                }
            }
            let submitted = client
                .run_submit(SubmitRunParams {
                    prompt,
                    model_id: None,
                    reasoning_effort: state.reasoning_effort.clone(),
                    quick_mode: None,
                    autonomous: None,
                    computer_use: None,
                    computer_use_target: None,
                    use_logged_in_services: None,
                    agent_count: None,
                    project_id: None,
                    attachment_ids: Vec::new(),
                    client_mcp_tools: Vec::new(),
                    research_workflow: None,
                    private_chat: state.private_chat_enabled,
                })
                .await?;
            state.apply(UiAction::RunSubmitted(submitted.run));
        }
        InputAction::CancelSelectedRun => {
            let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
                state.status_line = "No selected conversation to cancel".to_string();
                return Ok(());
            };
            let canceled = client.run_cancel(RunIDParams { run_id }).await?;
            state.apply(UiAction::RunCanceled(canceled.run));
        }
        InputAction::DeleteSelectedRun => {
            let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
                state.status_line = "No selected conversation to delete".to_string();
                return Ok(());
            };
            client
                .run_delete(RunIDParams {
                    run_id: run_id.clone(),
                })
                .await?;
            state.apply(UiAction::RunDeleted(run_id));
        }
        InputAction::SelectPreviousRun => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectPreviousEffort);
            } else if state.model_selector_active() {
                state.apply(UiAction::SelectPreviousModel);
            } else if state.command_suggestions_active() {
                state.apply(UiAction::SelectPreviousCommandSuggestion);
            } else {
                state.apply(UiAction::SelectPreviousRun);
            }
        }
        InputAction::SelectNextRun => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectNextEffort);
            } else if state.model_selector_active() {
                state.apply(UiAction::SelectNextModel);
            } else if state.command_suggestions_active() {
                state.apply(UiAction::SelectNextCommandSuggestion);
            } else {
                state.apply(UiAction::SelectNextRun);
            }
        }
        InputAction::SelectPreviousEffort => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectPreviousEffort);
            }
        }
        InputAction::SelectNextEffort => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectNextEffort);
            }
        }
        InputAction::ScrollDetailsUp => state.apply(UiAction::ScrollDetailsUp),
        InputAction::ScrollDetailsDown => state.apply(UiAction::ScrollDetailsDown),
        InputAction::ClickAt { column, row } => {
            if state.effort_selector_active() {
                return Ok(());
            }
            if let Some(index) = ui::run_index_at(
                terminal_area,
                column,
                row,
                state.runs.len(),
                ui::run_scroll_offset(terminal_area, state),
                state.sidebar_collapsed,
            ) {
                state.apply(UiAction::SelectRunAtIndex(index));
            } else if let Some(action) = ui::footer_action_at(terminal_area, column, row) {
                match action {
                    ui::FooterAction::Submit => {
                        Box::pin(handle_input_action(
                            client,
                            state,
                            InputAction::SubmitPrompt,
                            terminal_area,
                            background_tasks,
                            space_dictation,
                        ))
                        .await?;
                    }
                    ui::FooterAction::Cancel => {
                        Box::pin(handle_input_action(
                            client,
                            state,
                            InputAction::CancelSelectedRun,
                            terminal_area,
                            background_tasks,
                            space_dictation,
                        ))
                        .await?;
                    }
                    ui::FooterAction::Delete => {
                        Box::pin(handle_input_action(
                            client,
                            state,
                            InputAction::DeleteSelectedRun,
                            terminal_area,
                            background_tasks,
                            space_dictation,
                        ))
                        .await?;
                    }
                    ui::FooterAction::ToggleSidebar => {
                        state.apply(UiAction::ToggleSidebar);
                    }
                    ui::FooterAction::Quit => state.apply(UiAction::QuitRequested),
                }
            }
        }
        InputAction::BackspacePrompt => {
            cancel_pending_space_dictation(space_dictation);
            if !state.effort_selector_active() {
                state.apply(UiAction::BackspacePrompt);
            }
        }
        InputAction::AppendPrompt(value) => {
            cancel_pending_space_dictation(space_dictation);
            if !state.effort_selector_active() {
                handle_character_input(state, value);
            }
        }
        InputAction::SpaceDictationPressed => {
            handle_space_dictation_pressed(state, space_dictation);
        }
        InputAction::SpaceDictationReleased => {
            handle_space_dictation_released(
                client.request_handle(),
                state,
                background_tasks,
                space_dictation,
            )?; // coverage:ignore-line -- structural multi-line call terminator.
        }
    }
    Ok(())
}

fn handle_space_dictation_pressed(state: &mut AppState, space_dictation: &mut SpaceDictationState) {
    if state.effort_selector_active() {
        return;
    }
    if state.focus != FocusArea::Prompt || state.model_selector_active() {
        handle_character_input(state, ' ');
        return;
    }
    if !matches!(space_dictation, SpaceDictationState::Idle) {
        return;
    }

    let space_index = state.prompt_input.len();
    handle_character_input(state, ' ');
    *space_dictation = SpaceDictationState::Pending {
        started_at: Instant::now(),
        space_index,
    };
    state.status_line = "Hold Space to dictate".to_string();
}

fn handle_space_dictation_released(
    request_handle: AppServerRequestHandle,
    state: &mut AppState,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    match std::mem::replace(space_dictation, SpaceDictationState::Idle) {
        SpaceDictationState::Idle => {}
        SpaceDictationState::Pending { .. } => {
            state.status_line = "Editing prompt".to_string();
        }
        // coverage:ignore-start -- finishes a live microphone stream and sends audio to app-server.
        SpaceDictationState::Recording { recording } => {
            state.command_output = Some("Voice\nTranscribing...".to_string());
            state.status_line = "Transcribing voice".to_string();
            let audio = match recording.finish() {
                Ok(audio) => audio,
                Err(err) => {
                    state.apply(UiAction::CommandOutputDisplayed {
                        title: "Voice".to_string(),
                        message: err.to_string(),
                    });
                    return Ok(());
                }
            };
            background_tasks.push(tokio::spawn(async move {
                BackgroundTaskResult::Ui(Box::new(
                    transcribe_voice_ui_action(request_handle, audio, false).await,
                ))
            }));
        } // coverage:ignore-end
    }
    Ok(())
}

// coverage:ignore-start -- starts real microphone capture after a terminal key hold.
fn start_space_dictation_if_due(state: &mut AppState, space_dictation: &mut SpaceDictationState) {
    let should_start = matches!(
        space_dictation,
        SpaceDictationState::Pending { started_at, .. }
            if started_at.elapsed() >= SPACE_DICTATION_HOLD_THRESHOLD
    );
    if !should_start {
        return;
    }

    if let SpaceDictationState::Pending { space_index, .. } = space_dictation {
        remove_pending_space(state, *space_index);
    }

    match voice::start_recording() {
        Ok(recording) => {
            *space_dictation = SpaceDictationState::Recording { recording };
            state.command_output =
                Some("Voice\nRecording... release Space to transcribe.".to_string());
            state.status_line = "Recording voice".to_string();
        }
        Err(err) => {
            *space_dictation = SpaceDictationState::Idle;
            state.apply(UiAction::CommandOutputDisplayed {
                title: "Voice".to_string(),
                message: err.to_string(),
            });
        }
    }
}
// coverage:ignore-end

fn cancel_pending_space_dictation(space_dictation: &mut SpaceDictationState) {
    if matches!(space_dictation, SpaceDictationState::Pending { .. }) {
        *space_dictation = SpaceDictationState::Idle;
    }
}

fn remove_pending_space(state: &mut AppState, space_index: usize) {
    if state.prompt_input.as_bytes().get(space_index) == Some(&b' ') {
        state.prompt_input.remove(space_index);
    }
}

async fn select_highlighted_model(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(model_id) = state
        .selected_model_option()
        .map(|option| option.id.clone())
    else {
        state.apply(UiAction::ModelSelectorClosed);
        return Ok(());
    };
    let result = client
        .model_select(taskforceai_app_protocol::ModelSelectParams {
            model_id: model_id.clone(),
        })
        .await?;
    let current_model = result
        .selected_model_id
        .clone()
        .unwrap_or_else(|| result.default_model_id.clone());
    state.set_current_model(current_model);
    state.apply(UiAction::CommandExecuted {
        title: "Model".to_string(),
        message: format!("Selected {model_id}."),
    });
    Ok(())
}

fn local_runs_allowed() -> bool {
    env::var("TASKFORCEAI_ALLOW_LOCAL_RUNS")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

fn handle_character_input(state: &mut AppState, value: char) {
    if state.focus == FocusArea::Runs && state.prompt_input.is_empty() {
        match value {
            'q' => state.apply(UiAction::QuitRequested),
            'k' => state.apply(UiAction::SelectPreviousRun),
            'j' => state.apply(UiAction::SelectNextRun),
            _ => state.apply(UiAction::AppendPrompt(value)),
        }
        return;
    }
    state.apply(UiAction::AppendPrompt(value));
}

async fn toggle_quick_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.quick_mode_get().await?;
    let result = client
        .quick_mode_set(QuickModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.status_line = if result.enabled {
        "Direct Chat enabled".to_string()
    } else {
        "Direct Chat disabled".to_string()
    };
    Ok(())
}

async fn toggle_autonomous_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.autonomous_mode_get().await?;
    let result = client
        .autonomous_mode_set(RunModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.status_line = if result.enabled {
        "Autonomous Mode enabled".to_string()
    } else {
        "Autonomous Mode disabled".to_string()
    };
    Ok(())
}

async fn toggle_computer_use_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.computer_use_mode_get().await?;
    let result = client
        .computer_use_mode_set(RunModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.status_line = if result.enabled {
        "Computer Use enabled".to_string()
    } else {
        "Computer Use disabled".to_string()
    };
    Ok(())
}

fn after_response_conversation_id(event: &AppServerEvent) -> Option<String> {
    let AppServerEvent::RunUpdated { run } = event else {
        return None;
    };
    if run.status != RunStatus::Completed {
        return None;
    }
    Some(run.id.clone())
}

#[cfg(test)]
mod tests;
