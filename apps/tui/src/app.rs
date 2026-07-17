use std::time::Duration;

use crossterm::event::{
    DisableFocusChange, DisableMouseCapture, EnableFocusChange, EnableMouseCapture,
    Event as CrosstermEvent, EventStream, KeyboardEnhancementFlags, PopKeyboardEnhancementFlags,
    PushKeyboardEnhancementFlags,
};
use crossterm::{
    execute,
    terminal::{self as crossterm_terminal, EnterAlternateScreen, LeaveAlternateScreen, SetTitle},
};
use futures_util::{stream::FuturesUnordered, StreamExt};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginPollResult, DeviceLoginStartResult, DynamicToolCallResponse,
    HistoryListParams, PromptQueueDispatchAfterResponseParams, RunRecord, RunStatus, ThreadRecord,
};
use tokio::task::JoinHandle;
use tokio::time;

use crate::input::{map_key_event_with_keyboard_enhancement, map_mouse_event, InputAction};
use crate::state::{AppState, UiAction};
use crate::ui;
use crate::update;
use crate::voice;

pub(crate) mod commands;
mod dictation;
pub(crate) mod format;
mod input;
mod input_modes;
mod polling;

use commands::{features, format_realtime_voice_result};
#[cfg(test)]
use polling::poll_login_if_due;
use polling::{
    poll_context_if_due, poll_git_context_if_due, poll_sync_if_due, replay_pending_prompt_if_due,
    schedule_login_poll_if_due,
};

use dictation::{start_space_dictation_if_due, SpaceDictationState};
#[cfg(test)]
use input::expand_workspace_mentions;
use input::{handle_input_action, submit_task_prompt};
use input_modes::handle_character_input;
#[cfg(test)]
use input_modes::refresh_file_suggestions;

pub(super) type UiTaskQueue = FuturesUnordered<JoinHandle<BackgroundTaskResult>>;

pub(super) enum BackgroundTaskResult {
    Ui(Box<UiAction>),
    RealtimeVoice(Result<voice::RealtimeTurnResult, voice::VoiceError>),
    PromptSubmission(Box<PromptSubmissionResult>),
    LoginStart {
        attempt_id: u64,
        result: Result<DeviceLoginStartResult, String>,
    },
    LoginPoll {
        attempt_id: u64,
        result: Result<DeviceLoginPollResult, String>,
    },
}

pub(super) struct PromptSubmissionResult {
    pub id: u64,
    pub outcome: Result<PromptSubmissionOutcome, String>,
}

pub(super) enum PromptSubmissionOutcome {
    Run(RunRecord),
    Turn {
        thread: ThreadRecord,
        run: RunRecord,
    },
    Steer(ThreadRecord),
}

// coverage:ignore-start -- live terminal event loop is exercised by TUI smoke tests.
pub async fn run_event_loop(
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    mouse_enabled: bool,
) -> Result<(), AppClientError> {
    let mut reader = EventStream::new();
    let mut tick = time::interval(Duration::from_millis(250));
    let mut animation_tick = time::interval(Duration::from_millis(80));
    animation_tick.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
    let mut startup_hydrated = false;
    let mut startup_update = startup_update_task();
    let mut startup_context_changed = false;
    let mut background_tasks: UiTaskQueue = FuturesUnordered::new();
    let mut space_dictation = SpaceDictationState::Idle;
    let mut last_terminal_title = String::new();
    features::run_hooks(state, "session_start").await;

    while !state.should_quit {
        render_event_loop_frame(state, terminal, &mut last_terminal_title)?;

        tokio::select! {
            maybe_event = reader.next() => {
                startup_context_changed |= handle_terminal_event(
                    maybe_event,
                    client,
                    state,
                    terminal,
                    keyboard_enhancement_enabled,
                    &mut background_tasks,
                    &mut space_dictation,
                ).await?;
            }
            maybe_result = background_tasks.next(), if !background_tasks.is_empty() => {
                startup_context_changed |= handle_background_task_completion(
                    maybe_result,
                    client,
                    state,
                ).await;
            }
            _ = animation_tick.tick(), if state.needs_animation() => {
                state.apply(UiAction::Tick);
            }
            maybe_event = client.next_event() => {
                let Some(event) = maybe_event? else {
                    return Err(AppClientError::Closed);
                };
                startup_context_changed = true;
                handle_runtime_event(client, state, event).await?;
            }
            _ = tick.tick() => {
                handle_periodic_tick(
                    client,
                    state,
                    &mut startup_hydrated,
                    &mut startup_update,
                    startup_context_changed,
                    &mut background_tasks,
                    &mut space_dictation,
                ).await;
            }
        }
        handle_external_editor_request(
            state,
            terminal,
            keyboard_enhancement_enabled,
            mouse_enabled,
        )
        .await;
    }

    if let Some(update) = startup_update {
        update.abort();
    }

    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- renders to the live Crossterm terminal backend.
fn render_event_loop_frame(
    state: &AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    last_terminal_title: &mut String,
) -> Result<(), AppClientError> {
    let title = crate::terminal_title::title(state);
    if title != *last_terminal_title {
        execute!(terminal.backend_mut(), SetTitle(&title)).map_err(AppClientError::Read)?;
        *last_terminal_title = title;
    }
    terminal
        .draw(|frame| ui::render(frame, state))
        .map_err(AppClientError::Read)?;
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- consumes live terminal events and terminal dimensions.
async fn handle_terminal_event(
    maybe_event: Option<Result<CrosstermEvent, std::io::Error>>,
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal: &Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<bool, AppClientError> {
    let Some(Ok(event)) = maybe_event else {
        return Ok(false);
    };
    let Some(action) = input_action_for_terminal_event(event, state, keyboard_enhancement_enabled)
    else {
        return Ok(false);
    };
    let size = terminal.size().map_err(AppClientError::Read)?;
    let area = Rect {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
    };
    if let Err(err) = handle_input_action(
        client,
        state,
        action,
        area,
        background_tasks,
        space_dictation,
    )
    .await
    {
        apply_interactive_error(state, err);
    }
    Ok(true)
}
// coverage:ignore-end

fn input_action_for_terminal_event(
    event: CrosstermEvent,
    state: &mut AppState,
    keyboard_enhancement_enabled: bool,
) -> Option<InputAction> {
    match event {
        CrosstermEvent::Key(key) => {
            map_key_event_with_keyboard_enhancement(key, keyboard_enhancement_enabled)
        }
        CrosstermEvent::Mouse(mouse) => map_mouse_event(mouse),
        CrosstermEvent::Paste(value) => Some(InputAction::PastePrompt(value)),
        CrosstermEvent::FocusGained => {
            state.terminal_focused = true;
            None
        }
        CrosstermEvent::FocusLost => {
            state.terminal_focused = false;
            None
        }
        _ => None,
    }
}

// coverage:ignore-start -- joins runtime tasks and may rehydrate through live app-server RPC.
async fn handle_background_task_completion(
    maybe_result: Option<Result<BackgroundTaskResult, tokio::task::JoinError>>,
    client: &mut AppServerClient,
    state: &mut AppState,
) -> bool {
    let Some(result) = maybe_result else {
        return false;
    };
    match result {
        Ok(result) => {
            let auth_completed = apply_background_task_result(state, result);
            if auth_completed {
                hydrate_startup_state(client, state).await;
                if state.authenticated {
                    state.command_output = None;
                    state.launch_screen_visible = true;
                    state.status_line = "Authenticated".to_string();
                }
            }
        }
        Err(err) => {
            state.apply(UiAction::CommandOutputDisplayed {
                title: "Task".to_string(),
                message: format!("Background task failed: {err}"),
            });
        }
    }
    true
}
// coverage:ignore-end

// coverage:ignore-start -- dispatches live app-server events and prompt-queue RPC.
async fn handle_runtime_event(
    client: &mut AppServerClient,
    state: &mut AppState,
    event: AppServerEvent,
) -> Result<(), AppClientError> {
    let after_response_conversation_id = after_response_conversation_id(&event);
    handle_app_server_event(client, state, event).await?;
    let Some(conversation_id) = after_response_conversation_id else {
        return Ok(());
    };
    match client
        .prompt_queue_dispatch_after_response(PromptQueueDispatchAfterResponseParams {
            conversation_id: Some(conversation_id),
        })
        .await
    {
        Ok(result) if result.dispatched => state.status_line = result.message,
        Ok(_) => {}
        Err(err) => apply_interactive_error(state, err),
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- schedules and polls live app-server background work.
async fn handle_periodic_tick(
    client: &mut AppServerClient,
    state: &mut AppState,
    startup_hydrated: &mut bool,
    startup_update: &mut Option<JoinHandle<StartupUpdateResult>>,
    startup_context_changed: bool,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) {
    start_space_dictation_if_due(state, space_dictation);
    if !*startup_hydrated {
        hydrate_startup_state(client, state).await;
        *startup_hydrated = true;
        return;
    }
    if startup_update.as_ref().is_some_and(JoinHandle::is_finished) {
        apply_finished_startup_update(state, startup_update.take(), startup_context_changed).await;
        return;
    }
    if let Some(task) = schedule_login_poll_if_due(client.request_handle(), state) {
        background_tasks.push(task);
    }
    if !background_tasks.is_empty() {
        return;
    }
    poll_periodic_state(client, state).await;
}

async fn poll_periodic_state(client: &mut AppServerClient, state: &mut AppState) {
    if let Err(err) = poll_sync_if_due(client, state).await {
        apply_interactive_error(state, err);
    }
    if let Err(err) = replay_pending_prompt_if_due(client, state).await {
        apply_interactive_error(state, err);
    }
    if let Err(err) = poll_context_if_due(client, state).await {
        apply_interactive_error(state, err);
    }
    if let Err(err) = poll_git_context_if_due(client, state).await {
        apply_interactive_error(state, err);
    }
}
// coverage:ignore-end

// coverage:ignore-start -- suspends the live terminal and spawns the user's editor.
async fn handle_external_editor_request(
    state: &mut AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    mouse_enabled: bool,
) {
    if !state.external_editor_requested {
        return;
    }
    state.external_editor_requested = false;
    if let Err(error) =
        edit_prompt_externally(state, terminal, keyboard_enhancement_enabled, mouse_enabled).await
    {
        state.status_line = format!("External editor failed: {error}");
    }
}

async fn edit_prompt_externally(
    state: &mut AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    mouse_enabled: bool,
) -> std::io::Result<()> {
    suspend_terminal(terminal, keyboard_enhancement_enabled, mouse_enabled)?;
    let edited = crate::external_editor::edit(
        &state.expanded_prompt(),
        state.workspace.as_deref().map(std::path::Path::new),
    )
    .await;
    let resume_result = resume_terminal(terminal, keyboard_enhancement_enabled, mouse_enabled);
    match edited {
        Ok(edited) => state.replace_prompt_from_editor(edited),
        Err(error) => state.status_line = error.to_string(),
    }
    resume_result
}

fn suspend_terminal(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    mouse_enabled: bool,
) -> std::io::Result<()> {
    if mouse_enabled {
        execute!(terminal.backend_mut(), DisableMouseCapture)?;
    }
    execute!(terminal.backend_mut(), DisableFocusChange)?;
    if keyboard_enhancement_enabled {
        execute!(terminal.backend_mut(), PopKeyboardEnhancementFlags)?;
    }
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    crossterm_terminal::disable_raw_mode()
}

fn resume_terminal(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    keyboard_enhancement_enabled: bool,
    mouse_enabled: bool,
) -> std::io::Result<()> {
    crossterm_terminal::enable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        EnterAlternateScreen,
        EnableFocusChange
    )?;
    if mouse_enabled {
        execute!(terminal.backend_mut(), EnableMouseCapture)?;
    }
    if keyboard_enhancement_enabled {
        execute!(
            terminal.backend_mut(),
            PushKeyboardEnhancementFlags(
                KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
            )
        )?;
    }
    terminal.clear()
}
// coverage:ignore-end

fn apply_background_task_result(state: &mut AppState, result: BackgroundTaskResult) -> bool {
    match result {
        BackgroundTaskResult::Ui(action) => state.apply(*action),
        BackgroundTaskResult::RealtimeVoice(result) => {
            let (title, message) = format_realtime_voice_result(result);
            state.apply(UiAction::CommandOutputDisplayed { title, message });
        }
        BackgroundTaskResult::PromptSubmission(result) => match result.outcome {
            Ok(PromptSubmissionOutcome::Run(run)) => {
                state.apply(UiAction::RunSubmitted(run));
                state.finish_prompt_submission(result.id, "Submitted prompt");
            }
            Ok(PromptSubmissionOutcome::Turn { thread, run }) => {
                state.set_active_thread(thread);
                state.upsert_run(run);
                let status = match state.task_mode {
                    crate::state::TaskMode::Work => "Started Work task",
                    crate::state::TaskMode::Code => "Started workspace Code task",
                    crate::state::TaskMode::Chat => "Submitted prompt",
                };
                state.finish_prompt_submission(result.id, status);
            }
            Ok(PromptSubmissionOutcome::Steer(thread)) => {
                state.set_active_thread(thread);
                state.finish_prompt_submission(result.id, "Steered the active task");
            }
            Err(message) => state.fail_prompt_submission(result.id, message),
        },
        BackgroundTaskResult::LoginStart { attempt_id, result } => match result {
            // coverage:ignore-start -- successful device login opens the host browser.
            Ok(result) if state.login_attempt_matches(attempt_id) => {
                let verification_uri_complete = result.verification_uri_complete.clone();
                state.apply(UiAction::LoginStarted { attempt_id, result });
                state.status_line = if commands::open_url(&verification_uri_complete).is_ok() {
                    "Browser opened for login approval".to_string()
                } else {
                    "Open the login URL manually".to_string()
                };
            }
            // coverage:ignore-end
            Ok(_) => {}
            Err(message) => state.mark_login_start_failed(attempt_id, message),
        },
        BackgroundTaskResult::LoginPoll { attempt_id, result } => match result {
            Ok(result) => {
                let approved =
                    result.status == "approved" && state.login_attempt_matches(attempt_id);
                state.apply(UiAction::LoginPolled { attempt_id, result });
                return approved;
            }
            Err(message) => state.mark_login_poll_failed(attempt_id, message),
        },
    }
    false
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
    // coverage:ignore-start -- Code startup hydration delegates to live git-context RPC polling.
    if state.task_mode == crate::state::TaskMode::Code {
        let _ = poll_git_context_if_due(client, state).await;
    }
    // coverage:ignore-end
    if state.initialized.capabilities.context {
        if let Ok(summary) = client.context_summary().await {
            state.apply_context_summary(summary);
        } else {
            state.mark_context_refresh_failed();
        }
    }
}

// coverage:ignore-start -- hydrates preferences from live app-server metadata RPC.
pub(crate) async fn hydrate_tui_preferences(client: &AppServerClient, state: &mut AppState) {
    input::hydrate_agent_count(client, state).await;
}
// coverage:ignore-end

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
    state.picker = None;
    state.status_line = "Command failed".to_string();
}

// coverage:ignore-start -- performs hooks, notifications, permission IO, and response RPC for live server events.
async fn handle_app_server_event(
    client: &AppServerClient,
    state: &mut AppState,
    event: AppServerEvent,
) -> Result<(), AppClientError> {
    let hook_event = match &event {
        AppServerEvent::RunUpdated { run } if run.status == RunStatus::Completed => {
            Some(("run_complete", "Task completed"))
        }
        AppServerEvent::RunUpdated { run } if run.status == RunStatus::Failed => {
            Some(("run_failed", "Task failed"))
        }
        AppServerEvent::RunUpdated { run } if run.status == RunStatus::Canceled => {
            Some(("run_stop", "Task stopped"))
        }
        AppServerEvent::ItemStarted { item, .. }
            if item.item_type == taskforceai_app_protocol::ThreadItemType::ToolCall =>
        {
            Some(("pre_tool", ""))
        }
        AppServerEvent::ItemCompleted { item, .. }
            if item.item_type == taskforceai_app_protocol::ThreadItemType::ToolCall =>
        {
            Some(("post_tool", ""))
        }
        AppServerEvent::ServerRequest { .. } => Some(("", "Task needs your attention")),
        _ => None,
    };
    if let Some((hook, message)) = hook_event {
        if !hook.is_empty() {
            features::run_hooks(state, hook).await;
        }
        if !message.is_empty() && !state.terminal_focused {
            crate::notifications::notify(message);
        }
    }
    if let AppServerEvent::ServerRequest { request } = &event {
        if let Some(decision) =
            crate::permissions::decision_for_request(state.workspace.as_deref(), request).await
        {
            match decision {
                crate::permissions::RuleDecision::Allow => {
                    client
                        .respond_server_request(
                            request.id.clone(),
                            serde_json::json!({"decision": "accept"}),
                        )
                        .await?;
                    state.status_line = "Approved by persistent permission rule".to_string();
                    return Ok(());
                }
                crate::permissions::RuleDecision::Deny => {
                    client
                        .respond_server_request(
                            request.id.clone(),
                            serde_json::json!({"decision": "decline"}),
                        )
                        .await?;
                    state.status_line = "Declined by persistent permission rule".to_string();
                    return Ok(());
                }
                crate::permissions::RuleDecision::Ask => {}
            }
        }
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
// coverage:ignore-end

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
