use std::time::Duration;

use crossterm::event::{Event as CrosstermEvent, EventStream};
use futures_util::{stream::FuturesUnordered, StreamExt};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AppServerEvent, DynamicToolCallResponse, HistoryListParams,
    PromptQueueDispatchAfterResponseParams, PromptQueueRecord, QuickModeSetParams, RunIDParams,
    RunModeSetParams, RunStatus, SubmitRunParams, ThreadStartParams, TurnStartParams,
    TurnSteerParams,
};
use tokio::task::JoinHandle;
use tokio::time;

use crate::input::{map_key_event_with_keyboard_enhancement, map_mouse_event, InputAction};
use crate::local_coding::local_runs_allowed;
use crate::state::{AppState, FocusArea, UiAction};
use crate::ui;
use crate::update;
use crate::voice;

mod commands;
mod dictation;
pub(crate) mod format;
mod polling;

use commands::{format_realtime_voice_result, handle_local_command};
use polling::{poll_login_if_due, poll_sync_if_due, replay_pending_prompt_if_due};

use dictation::{
    cancel_pending_space_dictation, handle_space_dictation_pressed,
    handle_space_dictation_released, start_space_dictation_if_due, SpaceDictationState,
};

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
    let mut startup_context_changed = false;
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
                        CrosstermEvent::Paste(value) => Some(InputAction::PastePrompt(value)),
                        _ => None,
                    };
                    if let Some(action) = action {
                        startup_context_changed = true;
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
                    startup_context_changed = true;
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
                startup_context_changed = true;
                let after_response_conversation_id = after_response_conversation_id(&event);
                handle_app_server_event(client, state, event).await?;
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
                        apply_finished_startup_update(
                            state,
                            startup_update.take(),
                            startup_context_changed,
                        )
                        .await;
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
            state.quick_mode_enabled = status.quick_mode;
            state.autonomous_mode_enabled = status.autonomous;
            state.computer_use_enabled = status.computer_use;
            state.apply(UiAction::PetUpdated(status.pet));
        }
        Err(err) => apply_interactive_error(state, err),
    }
    match client.history_list(HistoryListParams { limit: 50 }).await {
        Ok(history) => state.apply(UiAction::HistoryLoaded(history.runs)),
        Err(err) => apply_interactive_error(state, err),
    }
    match client.thread_list().await {
        Ok(result) => state.set_threads(result.threads),
        Err(err) => apply_interactive_error(state, err),
    }
    match client.attachment_list().await {
        Ok(result) => state.attachments = result.attachments,
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
    preserve_current_context: bool,
) {
    let Some(update) = update else {
        return;
    };
    let result = update.await;
    if preserve_current_context {
        return;
    }
    match result {
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
    if state.interaction_active() {
        handle_interaction_input(client, state, action).await?;
        return Ok(());
    }
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
        InputAction::ToggleRawOutput => {
            state.raw_output_mode = !state.raw_output_mode;
            state.status_line = if state.raw_output_mode {
                "Raw output mode enabled"
            } else {
                "Raw output mode disabled"
            }
            .to_string();
        }
        InputAction::SubmitPrompt => submit_prompt_input(client, state, background_tasks).await?,
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
            } else if state.file_suggestions_active() {
                state.select_file_suggestion(-1);
            } else if state.focus == FocusArea::Prompt && !state.prompt_history.is_empty() {
                state.previous_prompt_history();
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
            } else if state.file_suggestions_active() {
                state.select_file_suggestion(1);
            } else if state.focus == FocusArea::Prompt && !state.prompt_history.is_empty() {
                state.next_prompt_history();
            } else {
                state.apply(UiAction::SelectNextRun);
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
                refresh_file_suggestions(client, state).await;
            }
        }
        InputAction::DeletePrompt => {
            if !state.effort_selector_active() {
                state.delete_prompt();
                refresh_file_suggestions(client, state).await;
            }
        }
        InputAction::MovePromptLeft => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectPreviousEffort);
            } else {
                state.move_prompt_left();
            }
        }
        InputAction::MovePromptRight => {
            if state.effort_selector_active() {
                state.apply(UiAction::SelectNextEffort);
            } else {
                state.move_prompt_right();
            }
        }
        InputAction::MovePromptHome => state.move_prompt_home(),
        InputAction::MovePromptEnd => state.move_prompt_end(),
        InputAction::InsertPromptNewline => {
            if !state.effort_selector_active() {
                state.insert_prompt_newline();
            }
        }
        InputAction::QueuePromptAfterResponse => {
            queue_prompt_after_response(client, state).await?;
        }
        InputAction::PastePrompt(value) => {
            cancel_pending_space_dictation(space_dictation);
            state.paste_prompt(&value);
            refresh_file_suggestions(client, state).await;
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

async fn submit_prompt_input(
    client: &mut AppServerClient,
    state: &mut AppState,
    background_tasks: &mut UiTaskQueue,
) -> Result<(), AppClientError> {
    if state.file_suggestions_active() && state.accept_file_suggestion() {
        return Ok(());
    }
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
    state.record_prompt_history(&prompt);
    if prompt.starts_with('/') {
        handle_local_command(client, state, &prompt, background_tasks).await?;
        return Ok(());
    }
    if let Some(thread_id) = state
        .active_thread_id
        .clone()
        .filter(|_| state.active_turn().is_some())
    {
        let input = prepare_task_prompt(client, state, &prompt).await;
        let steered = client
            .turn_steer(TurnSteerParams { thread_id, input })
            .await?;
        state.set_active_thread(steered.thread);
        state.clear_prompt();
        state.status_line = "Steered the active task".to_string();
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
    if state.task_mode != crate::state::TaskMode::Chat || state.active_thread_id.is_some() {
        submit_task_prompt(client, state, prompt).await?;
        return Ok(());
    }
    let submitted = client
        .run_submit(SubmitRunParams {
            prompt,
            model_id: None,
            reasoning_effort: state.reasoning_effort.clone(),
            quick_mode: Some(state.quick_mode_enabled),
            autonomous: Some(state.autonomous_mode_enabled),
            computer_use: Some(state.computer_use_enabled),
            computer_use_target: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: state
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
                .collect(),
            client_mcp_tools: Vec::new(),
            research_workflow: None,
            private_chat: state.private_chat_enabled,
        })
        .await?;
    state.apply(UiAction::RunSubmitted(submitted.run));
    Ok(())
}

pub(super) async fn submit_task_prompt(
    client: &AppServerClient,
    state: &mut AppState,
    prompt: String,
) -> Result<(), AppClientError> {
    let protocol_mode = match state.task_mode {
        crate::state::TaskMode::Chat => taskforceai_app_protocol::TaskMode::Chat,
        crate::state::TaskMode::Work => taskforceai_app_protocol::TaskMode::Work,
        crate::state::TaskMode::Code => taskforceai_app_protocol::TaskMode::Code,
    };
    let expanded_prompt = prepare_task_prompt(client, state, &prompt).await;
    let thread_id = if let Some(thread_id) = state.active_thread_id.clone() {
        thread_id
    } else {
        let title = prompt.chars().take(60).collect::<String>();
        let started = client
            .thread_start(ThreadStartParams {
                objective: prompt.clone(),
                thread_id: None,
                title: Some(title),
                source: Some("tui".to_string()),
                task_mode: protocol_mode,
            })
            .await?;
        let thread_id = started.thread.id.clone();
        state.set_active_thread(started.thread);
        thread_id
    };
    let attachment_ids = state
        .attachments
        .iter()
        .map(|attachment| attachment.id.clone())
        .collect::<Vec<_>>();
    let result = client
        .turn_start(TurnStartParams {
            thread_id,
            input: expanded_prompt,
            model_id: Some(state.current_model_id.clone()),
            reasoning_effort: state.reasoning_effort.clone(),
            quick_mode: Some(
                state.task_mode == crate::state::TaskMode::Chat && state.quick_mode_enabled,
            ),
            autonomous: Some(state.autonomous_mode_enabled),
            computer_use: Some(state.computer_use_enabled),
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids,
            client_mcp_tools: Vec::new(),
        })
        .await?;
    state.set_active_thread(result.thread);
    state.upsert_run(result.run);
    state.attachments.clear();
    state.clear_prompt();
    state.status_line = match state.task_mode {
        crate::state::TaskMode::Work => "Started Work task",
        crate::state::TaskMode::Code => "Started workspace Code task",
        crate::state::TaskMode::Chat => "Submitted prompt",
    }
    .to_string();
    Ok(())
}

async fn prepare_task_prompt(client: &AppServerClient, state: &AppState, prompt: &str) -> String {
    let expanded = expand_workspace_mentions(client, state, prompt).await;
    if state.task_mode == crate::state::TaskMode::Code {
        crate::local_coding::contextualize_prompt(state.workspace.as_deref(), &expanded)
    } else {
        expanded
    }
}

async fn expand_workspace_mentions(
    client: &AppServerClient,
    state: &AppState,
    prompt: &str,
) -> String {
    if state.task_mode != crate::state::TaskMode::Code {
        return prompt.to_string();
    }
    let mut paths = crate::local_coding::workspace_mention_paths(prompt);
    paths.sort_unstable();
    paths.dedup();
    paths.truncate(5);
    if paths.is_empty() {
        return prompt.to_string();
    }
    let mut context = Vec::new();
    for path in paths {
        if let Ok(file) = client
            .workspace_file_read(taskforceai_app_protocol::WorkspaceFileReadParams {
                workspace: state.workspace.clone(),
                path: path.clone(),
                max_bytes: Some(128 * 1024),
            })
            .await
        {
            if file.binary {
                context.push(format!(
                    "<workspace_file path=\"{}\" binary=\"true\" />",
                    file.path
                ));
            } else {
                let truncated = if file.truncated {
                    " truncated=\"true\""
                } else {
                    ""
                };
                context.push(format!(
                    "<workspace_file path=\"{}\"{}>\n{}\n</workspace_file>",
                    file.path, truncated, file.content
                ));
            }
        }
    }
    if context.is_empty() {
        prompt.to_string()
    } else {
        format!("{prompt}\n\n{}", context.join("\n\n"))
    }
}

async fn handle_interaction_input(
    client: &AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    let response = match action {
        InputAction::Quit => state.cancel_interaction(),
        InputAction::SubmitPrompt => match state.submit_interaction() {
            Ok(response) => response,
            Err(message) => {
                state.status_line = message;
                None
            }
        },
        InputAction::SelectPreviousRun | InputAction::MovePromptLeft => {
            state.move_interaction_selection(-1);
            None
        }
        InputAction::SelectNextRun | InputAction::MovePromptRight => {
            state.move_interaction_selection(1);
            None
        }
        InputAction::ScrollDetailsUp => {
            state.scroll_interaction(-10);
            None
        }
        InputAction::ScrollDetailsDown => {
            state.scroll_interaction(10);
            None
        }
        InputAction::BackspacePrompt => {
            state.backspace_interaction_input();
            None
        }
        InputAction::AppendPrompt(character) => {
            state.append_interaction_input(character);
            None
        }
        InputAction::PastePrompt(value) => {
            state.paste_interaction_input(&value);
            None
        }
        _ => None,
    };
    if let Some((request_id, result)) = response {
        client.respond_server_request(request_id, result).await?;
    }
    Ok(())
}

async fn handle_app_server_event(
    client: &AppServerClient,
    state: &mut AppState,
    event: AppServerEvent,
) -> Result<(), AppClientError> {
    if let AppServerEvent::ServerRequest { request } = &event {
        if request.method == "item/tool/call" {
            client
                .respond_server_request(
                    request.id.clone(),
                    DynamicToolCallResponse {
                        content_items: vec![serde_json::json!({
                            "type": "text",
                            "text": "This TUI does not expose client-side dynamic tools. Use an app-server MCP or workspace tool instead."
                        })],
                        success: false,
                    },
                )
                .await?;
            state.apply(UiAction::CommandOutputDisplayed {
                title: "Tool request".to_string(),
                message: "Declined unsupported client-side dynamic tool call.".to_string(),
            });
            return Ok(());
        }
    }
    state.apply(UiAction::ServerEvent(event));
    Ok(())
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

async fn refresh_file_suggestions(client: &AppServerClient, state: &mut AppState) {
    if state.task_mode != crate::state::TaskMode::Code {
        state.set_file_suggestions(Vec::new());
        return;
    }
    let Some(query) = state.mention_query().map(ToOwned::to_owned) else {
        state.set_file_suggestions(Vec::new());
        return;
    };
    match client
        .workspace_file_list(taskforceai_app_protocol::WorkspaceFileListParams {
            workspace: state.workspace.clone(),
            query: (!query.is_empty()).then_some(query),
            limit: Some(30),
        })
        .await
    {
        Ok(result) => state.set_file_suggestions(result.files),
        Err(_) => state.set_file_suggestions(Vec::new()),
    }
}

async fn queue_prompt_after_response(
    client: &AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let prompt = state.prompt_input.trim().to_string();
    if prompt.is_empty() {
        state.apply(UiAction::PromptSubmitRejected);
        return Ok(());
    }
    let conversation_id = state
        .active_turn()
        .map(|turn| turn.run_id.clone())
        .filter(|run_id| !run_id.is_empty())
        .or_else(|| state.selected_run_id().map(ToOwned::to_owned));
    let Some(conversation_id) = conversation_id else {
        state.status_line = "Start a task before queueing a follow-up".to_string();
        return Ok(());
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    state.record_prompt_history(&prompt);
    let result = client
        .prompt_queue_add(PromptQueueRecord {
            id: None,
            conversation_id,
            prompt,
            status: "queued".to_string(),
            dispatch_timing: "after_response".to_string(),
            created_at: now,
            updated_at: now,
            model_id: Some(state.current_model_id.clone()),
            reasoning_effort: state.reasoning_effort.clone(),
            attachment_ids: state
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
                .collect(),
        })
        .await?;
    let _ = client.attachment_clear().await;
    state.attachments.clear();
    state.clear_prompt();
    state.status_line = format!(
        "Queued follow-up {} for after the current response",
        result.queued_prompt.id.unwrap_or_default()
    );
    Ok(())
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
    state.quick_mode_enabled = result.enabled;
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
    state.autonomous_mode_enabled = result.enabled;
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
    state.computer_use_enabled = result.enabled;
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
