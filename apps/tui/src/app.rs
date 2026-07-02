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
                let Some(event) = maybe_event else {
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
            if state.model_selector_active() {
                state.apply(UiAction::ModelSelectorClosed);
            } else {
                state.apply(UiAction::QuitRequested);
            }
        }
        InputAction::ToggleFocus => state.apply(UiAction::ToggleFocus),
        InputAction::ToggleQuickMode => toggle_quick_mode(client, state).await?,
        InputAction::ToggleAutonomousMode => toggle_autonomous_mode(client, state).await?,
        InputAction::ToggleComputerUseMode => toggle_computer_use_mode(client, state).await?,
        InputAction::SubmitPrompt => {
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
                })
                .await?;
            state.apply(UiAction::RunSubmitted(submitted.run));
        }
        InputAction::CancelSelectedRun => {
            let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
                state.status_line = "No selected run to cancel".to_string();
                return Ok(());
            };
            let canceled = client.run_cancel(RunIDParams { run_id }).await?;
            state.apply(UiAction::RunCanceled(canceled.run));
        }
        InputAction::DeleteSelectedRun => {
            let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
                state.status_line = "No selected run to delete".to_string();
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
            if state.model_selector_active() {
                state.apply(UiAction::SelectPreviousModel);
            } else if state.command_suggestions_active() {
                state.apply(UiAction::SelectPreviousCommandSuggestion);
            } else {
                state.apply(UiAction::SelectPreviousRun);
            }
        }
        InputAction::SelectNextRun => {
            if state.model_selector_active() {
                state.apply(UiAction::SelectNextModel);
            } else if state.command_suggestions_active() {
                state.apply(UiAction::SelectNextCommandSuggestion);
            } else {
                state.apply(UiAction::SelectNextRun);
            }
        }
        InputAction::ScrollDetailsUp => state.apply(UiAction::ScrollDetailsUp),
        InputAction::ScrollDetailsDown => state.apply(UiAction::ScrollDetailsDown),
        InputAction::ClickAt { column, row } => {
            if let Some(index) = ui::run_index_at(
                terminal_area,
                column,
                row,
                state.runs.len(),
                ui::run_scroll_offset(terminal_area, state),
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
                    ui::FooterAction::Quit => state.apply(UiAction::QuitRequested),
                }
            }
        }
        InputAction::BackspacePrompt => {
            cancel_pending_space_dictation(space_dictation);
            state.apply(UiAction::BackspacePrompt);
        }
        InputAction::AppendPrompt(value) => {
            cancel_pending_space_dictation(space_dictation);
            handle_character_input(state, value);
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
            )?;
        }
    }
    Ok(())
}

fn handle_space_dictation_pressed(state: &mut AppState, space_dictation: &mut SpaceDictationState) {
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
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::thread;
    use std::time::Instant;

    use futures_util::stream::FuturesUnordered;
    use ratatui::layout::Rect;
    use serde_json::{json, Value};
    use taskforceai_app_client::{AppClientError, AppServerClient};
    use taskforceai_app_protocol::{
        AppServerEvent, Capabilities, DeviceLoginStartResult, InitializeResult, ModelListResult,
        ModelOptionRecord, OllamaMemoryRecommendation, OllamaStatusResult, RunRecord, RunStatus,
        ServerInfo, TransportInfo, JSONRPC_VERSION,
    };

    use super::format::{format_model_list, format_ollama_status};
    use super::{
        after_response_conversation_id, apply_finished_startup_update, apply_interactive_error,
        handle_character_input, handle_input_action, hydrate_startup_state, poll_login_if_due,
        poll_sync_if_due, replay_pending_prompt_if_due, startup_update_result, startup_update_task,
        SpaceDictationState, StartupUpdateResult, UiTaskQueue,
    };
    use crate::input::InputAction;
    use crate::state::{FocusArea, UiAction};
    use crate::update::{UpdateCheck, UpdateError};

    static APP_ENV_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn initialized() -> InitializeResult {
        InitializeResult {
            server: ServerInfo::default(),
            transport: TransportInfo {
                kind: "stdio".to_string(),
                encoding: "jsonl".to_string(),
            },
            capabilities: Capabilities {
                auth: true,
                runs: true,
                history: true,
                pending_prompts: true,
                projects: true,
                attachments: true,
                context: true,
                memory: true,
                mcp: true,
                sync: true,
                events: true,
                skills: true,
                plugins: true,
                computer_use: true,
                browser: true,
                agent_sessions: true,
                threads: true,
                turns: true,
                diagnostics: true,
                channels: true,
                schedules: true,
                workflows: true,
                voice: true,
            },
        }
    }

    fn run(id: &str, status: RunStatus) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "hello".to_string(),
            model_id: None,
            project_id: None,
            status,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    fn model_list(selected: Option<&str>) -> ModelListResult {
        ModelListResult {
            enabled: true,
            options: vec![
                ModelOptionRecord {
                    id: "sentinel".to_string(),
                    label: "Sentinel".to_string(),
                    badge: "default".to_string(),
                    description: Some("Default model".to_string()),
                    usage_multiple: Some(1.0),
                },
                ModelOptionRecord {
                    id: "gpt-5".to_string(),
                    label: "GPT-5".to_string(),
                    badge: "deep".to_string(),
                    description: None,
                    usage_multiple: None,
                },
            ],
            default_model_id: "sentinel".to_string(),
            selected_model_id: selected.map(ToOwned::to_owned),
            remote_catalog: false,
        }
    }

    fn empty_model_list() -> ModelListResult {
        ModelListResult {
            enabled: true,
            options: Vec::new(),
            default_model_id: "sentinel".to_string(),
            selected_model_id: None,
            remote_catalog: false,
        }
    }

    fn pet_json() -> Value {
        json!({
            "name": "Sentinel",
            "mood": "focus",
            "visible": true,
            "message": "Ready."
        })
    }

    fn status_summary_json() -> Value {
        json!({
            "transport": "http",
            "authenticated": true,
            "runCount": 1,
            "modelId": "sentinel",
            "quickMode": false,
            "autonomous": false,
            "computerUse": false,
            "pet": pet_json()
        })
    }

    fn run_json(id: &str, status: RunStatus) -> Value {
        serde_json::to_value(run(id, status)).expect("run should serialize")
    }

    fn rpc_response(id: Value, result: Value) -> String {
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": id,
            "result": result
        })
        .to_string()
    }

    fn start_rpc_sequence_server(
        responses: Vec<(&'static str, Value)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("rpc server should bind");
        let address = listener
            .local_addr()
            .expect("rpc address should be readable");
        let server = thread::spawn(move || {
            for (expected_method, result) in responses {
                let (mut stream, _) = listener.accept().expect("rpc request should connect");
                let body = read_http_body(&mut stream);
                let request: Value =
                    serde_json::from_str(&body).expect("rpc request body should be json");
                assert_eq!(request["method"], expected_method);
                let response_body = rpc_response(request["id"].clone(), result);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("rpc response should write");
            }
        });
        (format!("http://{address}"), server)
    }

    fn read_http_body(stream: &mut std::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        let header_end = loop {
            let read = stream.read(&mut chunk).expect("request should read");
            if read == 0 {
                break buffer.len();
            }
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8_lossy(&buffer[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while buffer.len().saturating_sub(header_end) < content_length {
            let read = stream.read(&mut chunk).expect("request body should read");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }
        String::from_utf8_lossy(
            &buffer[header_end..header_end + content_length.min(buffer.len() - header_end)],
        )
        .to_string()
    }

    #[test]
    fn after_response_dispatch_triggers_only_for_completed_runs() {
        let mut run = RunRecord {
            id: "run_1".to_string(),
            prompt: "hello".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Processing,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 2,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        };

        assert_eq!(
            after_response_conversation_id(&AppServerEvent::RunUpdated {
                run: Box::new(run.clone())
            }),
            None
        );
        run.status = RunStatus::Completed;
        assert_eq!(
            after_response_conversation_id(&AppServerEvent::RunUpdated { run: Box::new(run) }),
            Some("run_1".to_string())
        );
        assert_eq!(
            after_response_conversation_id(&AppServerEvent::RunDeleted {
                run_id: "run_1".to_string()
            }),
            None
        );
    }

    #[test]
    fn interactive_rpc_errors_render_without_quitting() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.prompt_input = "preserve this prompt".to_string();

        apply_interactive_error(
            &mut state,
            AppClientError::Rpc {
                code: -32030,
                message: "api error: api returned status 403".to_string(),
            },
        );

        assert!(!state.should_quit);
        assert_eq!(state.status_line, "Command failed");
        assert_eq!(state.prompt_input, "preserve this prompt");
        assert_eq!(
            state.command_output.as_deref(),
            Some("Error\nRequest failed (-32030): api error: api returned status 403")
        );

        apply_interactive_error(&mut state, AppClientError::Closed);
        assert_eq!(state.status_line, "Command failed");
        assert!(state
            .command_output
            .as_deref()
            .expect("closed output")
            .starts_with("Error\n"));
    }

    #[test]
    fn formats_model_list_with_selection_and_usage() {
        let result = ModelListResult {
            enabled: true,
            options: vec![
                ModelOptionRecord {
                    id: "model-a".to_string(),
                    label: "Model A".to_string(),
                    badge: "fast".to_string(),
                    description: Some("Fast path".to_string()),
                    usage_multiple: Some(1.5),
                },
                ModelOptionRecord {
                    id: "model-b".to_string(),
                    label: "Model B".to_string(),
                    badge: "deep".to_string(),
                    description: None,
                    usage_multiple: None,
                },
            ],
            default_model_id: "model-a".to_string(),
            selected_model_id: Some("model-b".to_string()),
            remote_catalog: true,
        };

        assert_eq!(
            format_model_list(&result),
            "selected: model-b\ncatalog: remote\n- model-a [fast] - Fast path (1.5x)\n* model-b [deep]"
        );
    }

    #[test]
    fn formats_ollama_status_with_memory_recommendation() {
        let result = OllamaStatusResult {
            provider_id: "ollama".to_string(),
            base_url: "http://localhost:11434/v1".to_string(),
            host_root: "http://localhost:11434".to_string(),
            connected: true,
            openai_compatible: true,
            responses_supported: Some(true),
            version: Some("0.12.0".to_string()),
            models: vec!["gemma4:31b".to_string()],
            default_model: "gemma4:31b".to_string(),
            memory: OllamaMemoryRecommendation {
                total_bytes: Some(34_359_738_368),
                total_label: "32.0 GiB".to_string(),
                recommended_model_id: "ollama/gemma4:31b".to_string(),
                recommended_model: "gemma4:31b".to_string(),
                minimum_bytes: 25_769_803_776,
                reason: "Detected enough memory for Gemma 4 31B.".to_string(),
            },
            message: None,
        };

        assert_eq!(
            format_ollama_status(&result),
            "connected: true\nbase url: http://localhost:11434/v1\nmemory: 32.0 GiB\nrecommended: ollama/gemma4:31b\nreason: Detected enough memory for Gemma 4 31B.\nversion: 0.12.0\ninstalled: gemma4:31b\nUse /model set ollama/gemma4:31b to select it.\nUse /ollama ensure gemma4:31b to prepare it."
        );
    }

    #[test]
    fn run_focus_letters_control_navigation_without_blocking_prompt_typing() {
        let mut state = crate::state::AppState::new(
            initialized(),
            vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
        );

        state.apply(UiAction::ToggleFocus);
        handle_character_input(&mut state, 'j');
        assert_eq!(state.selected_run_id(), Some("r2"));
        handle_character_input(&mut state, 'k');
        assert_eq!(state.selected_run_id(), Some("r1"));
        handle_character_input(&mut state, 'q');
        assert!(state.should_quit);

        let mut prompt_state = crate::state::AppState::new(initialized(), Vec::new());
        assert_eq!(prompt_state.focus, FocusArea::Prompt);
        handle_character_input(&mut prompt_state, 'q');
        assert_eq!(prompt_state.prompt_input, "q");
        assert!(!prompt_state.should_quit);
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn input_actions_cover_rpc_modes_submit_and_run_lifecycle() {
        let _guard = APP_ENV_TEST_LOCK.lock().expect("app env test lock");
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("quickMode.get", json!({"enabled": false})),
            ("quickMode.set", json!({"enabled": true})),
            ("autonomousMode.get", json!({"enabled": false})),
            ("autonomousMode.set", json!({"enabled": true})),
            ("computerUseMode.get", json!({"enabled": true})),
            ("computerUseMode.set", json!({"enabled": false})),
            ("auth.status", json!({"authenticated": false, "user": null})),
            (
                "auth.status",
                json!({"authenticated": true, "user": {"id": "u1"}}),
            ),
            (
                "run.submit",
                json!({"run": run_json("submitted", RunStatus::Queued)}),
            ),
            (
                "run.cancel",
                json!({"run": run_json("submitted", RunStatus::Canceled)}),
            ),
            ("run.delete", json!({"ok": true})),
            (
                "model.select",
                serde_json::to_value(model_list(Some("gpt-5")))
                    .expect("model list should serialize"),
            ),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        let area = Rect::new(0, 0, 120, 30);
        let mut tasks: UiTaskQueue = FuturesUnordered::new();
        let mut space_dictation = SpaceDictationState::Idle;

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleQuickMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("quick mode toggle should succeed");
        assert_eq!(state.status_line, "Direct Chat enabled");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleAutonomousMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("autonomous mode toggle should succeed");
        assert_eq!(state.status_line, "Autonomous Mode enabled");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleComputerUseMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("computer use toggle should succeed");
        assert_eq!(state.status_line, "Computer Use disabled");

        state.prompt_input = "needs auth".to_string();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("unauthenticated submit should render guidance");
        assert_eq!(
            state.command_output.as_deref(),
            Some("Login Required\nNot authenticated. Use /login first.")
        );

        state.prompt_input = "ship it".to_string();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("authenticated submit should succeed");
        assert_eq!(state.selected_run_id(), Some("submitted"));
        assert_eq!(state.status_line, "Submitted run");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::CancelSelectedRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("cancel selected run should succeed");
        assert_eq!(state.runs[0].status, RunStatus::Canceled);

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::DeleteSelectedRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("delete selected run should succeed");
        assert!(state.runs.is_empty());

        state.apply(UiAction::ModelSelectorOpened(model_list(None)));
        state.apply(UiAction::SelectNextModel);
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("model selector submit should select highlighted model");
        assert_eq!(state.current_model_id, "gpt-5");
        assert_eq!(
            state.command_output.as_deref(),
            Some("Model\nSelected gpt-5.")
        );

        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn input_actions_cover_local_navigation_clicks_and_space_dictation() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(
            initialized(),
            vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
        );
        let area = Rect::new(0, 0, 120, 30);
        let mut tasks: UiTaskQueue = FuturesUnordered::new();
        let mut space_dictation = SpaceDictationState::Idle;

        state.apply(UiAction::ModelSelectorOpened(model_list(None)));
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::Quit,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("quit should close model selector first");
        assert!(!state.should_quit);
        assert!(!state.model_selector_active());

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleFocus,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("focus toggle should succeed");
        assert_eq!(state.focus, FocusArea::Runs);

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectNextRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("next run should succeed");
        assert_eq!(state.selected_run_id(), Some("r2"));

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectPreviousRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("previous run should succeed");
        assert_eq!(state.selected_run_id(), Some("r1"));

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ScrollDetailsDown,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("scroll down should succeed");
        assert_eq!(state.detail_scroll_offset, 10);

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ScrollDetailsUp,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("scroll up should succeed");
        assert_eq!(state.detail_scroll_offset, 0);

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt { column: 2, row: 6 },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("run list click should select visible row");
        assert_eq!(state.selected_run_id(), Some("r2"));

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationPressed,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("space in runs focus should append prompt text");
        assert_eq!(state.prompt_input, " ");

        state.apply(UiAction::ToggleFocus);
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::BackspacePrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("backspace should edit prompt");
        assert_eq!(state.prompt_input, "");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationPressed,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("space press should start pending dictation");
        assert_eq!(state.status_line, "Hold Space to dictate");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationReleased,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("early space release should type a space");
        assert_eq!(state.prompt_input, " ");

        state.prompt_input.clear();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationPressed,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("space press should insert a pending normal space");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::AppendPrompt('x'),
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("typing after pending space should preserve order");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationReleased,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("release after canceled pending space should no-op");
        assert_eq!(state.prompt_input, " x");

        state.prompt_input.clear();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("empty prompt submit should be rejected");
        assert_eq!(state.status_line, "Type a prompt before submitting");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::Quit,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("quit should request shutdown");
        assert!(state.should_quit);

        server.join().expect("empty rpc sequence should finish");
    }

    #[tokio::test]
    async fn input_actions_cover_empty_model_footer_and_suggestion_edges() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(
            initialized(),
            vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
        );
        let area = Rect::new(0, 0, 120, 30);
        let footer_row = 28;
        let mut tasks: UiTaskQueue = FuturesUnordered::new();
        let mut space_dictation = SpaceDictationState::Idle;

        state.focus = FocusArea::Runs;
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("runs-focused submit should load selected run");
        assert_eq!(state.focus, FocusArea::Prompt);
        assert_eq!(state.prompt_input, "hello");

        state.apply(UiAction::ModelSelectorOpened(empty_model_list()));
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("empty model selector submit should close selector");
        assert!(!state.model_selector_active());

        state.prompt_input = "/".to_string();
        state.apply(UiAction::AppendPrompt('m'));
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectPreviousRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("previous command suggestion should be handled");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectNextRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("next command suggestion should be handled");
        assert!(state.command_suggestions_active());

        state.apply(UiAction::ModelSelectorOpened(model_list(None)));
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectPreviousRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("previous model should be handled");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SelectNextRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("next model should be handled");
        assert!(state.model_selector_active());
        state.apply(UiAction::ModelSelectorClosed);

        state.apply(UiAction::HistoryLoaded(Vec::new()));
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::CancelSelectedRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("empty cancel should be handled");
        assert_eq!(state.status_line, "No selected run to cancel");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::DeleteSelectedRun,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("empty delete should be handled");
        assert_eq!(state.status_line, "No selected run to delete");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationReleased,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("idle space release should be a no-op");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::AppendPrompt('x'),
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("append prompt action should be handled");
        assert!(state.prompt_input.ends_with('x'));

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationPressed,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("space press should enter pending state");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SpaceDictationPressed,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("second space press should no-op while pending");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt {
                column: 119,
                row: 0,
            },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("outside click should no-op");

        state.prompt_input.clear();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt {
                column: 1,
                row: footer_row,
            },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("footer submit click should be handled");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt {
                column: 16,
                row: footer_row,
            },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("footer cancel click should be handled");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt {
                column: 32,
                row: footer_row,
            },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("footer delete click should be handled");
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ClickAt {
                column: 101,
                row: footer_row,
            },
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("footer quit click should be handled");
        assert!(state.should_quit);

        server.join().expect("empty rpc sequence should finish");
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn input_actions_cover_disabled_toggles_and_local_runs() {
        let _guard = APP_ENV_TEST_LOCK.lock().expect("app env test lock");
        let previous = std::env::var_os("TASKFORCEAI_ALLOW_LOCAL_RUNS");
        std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", "1");
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("quickMode.get", json!({"enabled": true})),
            ("quickMode.set", json!({"enabled": false})),
            ("autonomousMode.get", json!({"enabled": true})),
            ("autonomousMode.set", json!({"enabled": false})),
            ("computerUseMode.get", json!({"enabled": false})),
            ("computerUseMode.set", json!({"enabled": true})),
            (
                "run.submit",
                json!({"run": run_json("local", RunStatus::Queued)}),
            ),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        let area = Rect::new(0, 0, 120, 30);
        let mut tasks: UiTaskQueue = FuturesUnordered::new();
        let mut space_dictation = SpaceDictationState::Idle;

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleQuickMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("quick mode should disable");
        assert_eq!(state.status_line, "Direct Chat disabled");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleAutonomousMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("autonomous mode should disable");
        assert_eq!(state.status_line, "Autonomous Mode disabled");

        handle_input_action(
            &mut client,
            &mut state,
            InputAction::ToggleComputerUseMode,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("computer use should enable");
        assert_eq!(state.status_line, "Computer Use enabled");

        state.prompt_input = "local prompt".to_string();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("local run submit should skip auth");
        assert_eq!(state.selected_run_id(), Some("local"));

        if let Some(previous) = previous {
            std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", previous);
        } else {
            std::env::remove_var("TASKFORCEAI_ALLOW_LOCAL_RUNS");
        }
        server.join().expect("toggle rpc sequence should finish");
    }

    #[tokio::test]
    async fn startup_hydration_and_due_polling_use_app_server_results() {
        let (base_url, server) = start_rpc_sequence_server(vec![
            ("status.summary", status_summary_json()),
            (
                "history.list",
                json!({"runs": [run_json("history", RunStatus::Completed)]}),
            ),
            (
                "auth.devicePoll",
                json!({
                    "status": "pending",
                    "token": null,
                    "expiresIn": null,
                    "interval": 1,
                    "message": null
                }),
            ),
            (
                "sync.realtimePoll",
                json!({"hasUpdates": true, "lastEventId": "evt-2"}),
            ),
            (
                "sync.pull",
                json!({
                    "deviceId": "device",
                    "latestVersion": 2,
                    "conversations": [],
                    "messages": [],
                    "deletions": []
                }),
            ),
            (
                "history.list",
                json!({"runs": [run_json("synced", RunStatus::Queued)]}),
            ),
            (
                "pendingPrompt.replay",
                json!({
                    "attempted": true,
                    "prompt": null,
                    "run": run_json("pending", RunStatus::Queued),
                    "remaining": 0,
                    "message": "Pending prompt replayed."
                }),
            ),
        ]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());

        hydrate_startup_state(&mut client, &mut state).await;
        assert_eq!(state.current_model_id, "sentinel");
        assert_eq!(state.selected_run_id(), Some("history"));
        assert_eq!(state.pet.name, "Sentinel");

        state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
            device_code: "device-code".to_string(),
            user_code: "ABCD-1234".to_string(),
            verification_uri: "https://example.test/device".to_string(),
            verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
            expires_in: 600,
            interval: 5,
        }));
        state
            .pending_login
            .as_mut()
            .expect("login should be pending")
            .next_poll_at = Instant::now();
        poll_login_if_due(&mut client, &mut state)
            .await
            .expect("login poll should succeed");
        assert_eq!(state.status_line, "Waiting for login approval");

        state.next_sync_poll_at = Instant::now();
        poll_sync_if_due(&mut client, &mut state)
            .await
            .expect("sync poll should succeed");
        assert_eq!(state.last_sync_event_id.as_deref(), Some("evt-2"));
        assert_eq!(state.selected_run_id(), Some("synced"));
        assert_eq!(
            state.status_line,
            "Sync pulled 0 conversations and 0 messages"
        );

        state.next_pending_replay_at = Instant::now();
        replay_pending_prompt_if_due(&mut client, &mut state)
            .await
            .expect("pending prompt replay should succeed");
        assert!(state.runs.iter().any(|run| run.id == "pending"));
        assert_eq!(state.status_line, "Pending prompt replayed.");

        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn sync_pull_errors_stay_in_status_line_without_clobbering_context() {
        let (base_url, server) = start_rpc_sequence_server(vec![(
            "sync.realtimePoll",
            json!({"hasUpdates": true, "lastEventId": "evt-3"}),
        )]);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.apply(UiAction::ModelSelectorOpened(model_list(None)));
        state.command_output = Some("Details\nkeep this visible".to_string());
        state.next_sync_poll_at = Instant::now();

        poll_sync_if_due(&mut client, &mut state)
            .await
            .expect("sync pull error should be absorbed");

        assert_eq!(state.last_sync_event_id.as_deref(), Some("evt-3"));
        assert!(state.status_line.contains("Sync pull failed"));
        assert!(state.model_selector_active());
        assert_eq!(
            state.command_output.as_deref(),
            Some("Details\nkeep this visible")
        );
        server.join().expect("rpc sequence should finish");
    }

    #[tokio::test]
    async fn startup_hydration_and_due_polling_cover_error_and_noop_edges() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("error server bind");
        let base_url = format!(
            "http://{}",
            listener.local_addr().expect("error server address")
        );
        drop(listener);
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());

        hydrate_startup_state(&mut client, &mut state).await;
        assert_eq!(state.status_line, "Command failed");

        poll_login_if_due(&mut client, &mut state)
            .await
            .expect("missing login should no-op");
        poll_sync_if_due(&mut client, &mut state)
            .await
            .expect("not-due sync should no-op");
        replay_pending_prompt_if_due(&mut client, &mut state)
            .await
            .expect("not-due replay should no-op");

        state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
            device_code: "expired-device".to_string(),
            user_code: "ABCD-1234".to_string(),
            verification_uri: "https://example.test/device".to_string(),
            verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
            expires_in: 600,
            interval: 5,
        }));
        state
            .pending_login
            .as_mut()
            .expect("expired login should be pending")
            .expires_at = Instant::now() - std::time::Duration::from_secs(1);
        poll_login_if_due(&mut client, &mut state)
            .await
            .expect("expired login should be handled");
        assert_eq!(state.status_line, "Login expired");

        state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
            device_code: "due-device".to_string(),
            user_code: "ABCD-1234".to_string(),
            verification_uri: "https://example.test/device".to_string(),
            verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
            expires_in: 600,
            interval: 5,
        }));
        state
            .pending_login
            .as_mut()
            .expect("due login should be pending")
            .next_poll_at = Instant::now();
        poll_login_if_due(&mut client, &mut state)
            .await
            .expect("login poll error should be absorbed");
        assert!(state.status_line.contains("Login poll failed"));

        state.next_sync_poll_at = Instant::now();
        poll_sync_if_due(&mut client, &mut state)
            .await
            .expect("sync poll error should be absorbed");
        assert!(state.status_line.contains("Sync poll failed"));

        state.next_pending_replay_at = Instant::now();
        replay_pending_prompt_if_due(&mut client, &mut state)
            .await
            .expect("pending replay error should be absorbed");
        assert!(state.status_line.contains("Pending replay failed"));
    }

    #[tokio::test]
    async fn slash_submit_delegates_to_local_command_handler() {
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token")
            .expect("test client should connect");
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        let area = Rect::new(0, 0, 120, 30);
        let mut tasks: UiTaskQueue = FuturesUnordered::new();
        let mut space_dictation = SpaceDictationState::Idle;

        state.prompt_input = "/clear".to_string();
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::SubmitPrompt,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("slash command submit should be handled");
        assert_eq!(state.status_line, "Cleared");

        server.join().expect("empty rpc sequence should finish");
    }

    #[tokio::test]
    async fn startup_update_helpers_cover_status_and_join_paths() {
        let mut state = crate::state::AppState::new(initialized(), Vec::new());
        state.status_line = "unchanged".to_string();
        apply_finished_startup_update(&mut state, None).await;
        assert_eq!(state.status_line, "unchanged");

        apply_finished_startup_update(
            &mut state,
            Some(tokio::spawn(async {
                StartupUpdateResult {
                    command_output: Some("Update\nok".to_string()),
                    status_line: "updated".to_string(),
                }
            })),
        )
        .await;
        assert_eq!(state.command_output.as_deref(), Some("Update\nok"));
        assert_eq!(state.status_line, "updated");

        let aborted_update = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            StartupUpdateResult {
                command_output: None,
                status_line: String::new(),
            }
        });
        aborted_update.abort();
        apply_finished_startup_update(&mut state, Some(aborted_update)).await;
        assert!(state
            .command_output
            .as_deref()
            .expect("panic output")
            .contains("Auto-update task failed"));
        assert_eq!(state.status_line, "Auto-update failed");

        let current = startup_update_result(Ok(None)).await;
        assert_eq!(current.command_output, None);
        assert_eq!(
            current.status_line,
            "Connected to app-server; already on latest version"
        );

        let failed =
            startup_update_result(Err(UpdateError::MissingAsset("archive".to_string()))).await;
        assert!(failed
            .command_output
            .as_deref()
            .expect("failed output")
            .contains("Auto-update check failed"));

        let previous_disable = std::env::var_os("TASKFORCEAI_DISABLE_AUTOUPDATE");
        std::env::set_var("TASKFORCEAI_DISABLE_AUTOUPDATE", "1");
        assert!(startup_update_task().is_none());
        let disabled_apply = startup_update_result(Ok(Some(UpdateCheck {
            current_version: "1.0.0".to_string(),
            latest_version: "1.1.0".to_string(),
            archive_name: "taskforceai-cli-darwin-arm64.tar.gz".to_string(),
            download_url: "https://example.test/archive".to_string(),
            checksums_url: "https://example.test/checksums".to_string(),
        })))
        .await;
        assert!(disabled_apply
            .command_output
            .as_deref()
            .expect("disabled apply output")
            .contains("Auto-update failed"));
        if let Some(previous_disable) = previous_disable {
            std::env::set_var("TASKFORCEAI_DISABLE_AUTOUPDATE", previous_disable);
        } else {
            std::env::remove_var("TASKFORCEAI_DISABLE_AUTOUPDATE");
        }
    }
}
