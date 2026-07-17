use std::time::Duration;

use ratatui::layout::Rect;
use taskforceai_app_client::{AppClientError, AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::{
    RunIDParams, RunStatus, SubmitRunParams, ThreadStartParams, TurnInterruptParams,
    TurnStartParams, TurnSteerParams,
};

use crate::input::InputAction;
use crate::local_coding::local_runs_allowed;
use crate::prompt_history;
use crate::state::{
    AppState, AuthUiState, EffortSelectorState, FocusArea, ModelSelectorTarget, UiAction,
};
use crate::ui;

use super::commands::{self, features, handle_local_command};
use super::dictation::SpaceDictationState;
use super::input_modes::select_highlighted_model;
use super::{BackgroundTaskResult, PromptSubmissionOutcome, PromptSubmissionResult, UiTaskQueue};

mod actions;
mod picker;
mod team;

use picker::{cancel_picker, handle_picker_input};
pub(super) use team::hydrate_agent_count;

// coverage:ignore-start -- top-level input adapter dispatches RPC, clipboard, editor, and terminal actions.
pub(super) async fn handle_input_action(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
    terminal_area: Rect,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    if state.team_config_active() || state.agent_mode_selector_active() {
        team::handle_team_selector_input(client, state, action).await?;
        return Ok(());
    }
    if state.picker_active() {
        handle_picker_input(client, state, action).await?;
        return Ok(());
    }
    if state.interaction_active() {
        handle_interaction_input(client, state, action).await?;
        return Ok(());
    }
    if state.launch_screen_visible
        && state.auth_checked
        && state.auth_ui_state() != AuthUiState::SignedIn
        && handle_launch_auth_input(client, state, &action, terminal_area, background_tasks)
    {
        return Ok(());
    }
    actions::handle_action(
        client,
        state,
        action,
        terminal_area,
        background_tasks,
        space_dictation,
    )
    .await
}
// coverage:ignore-end

// coverage:ignore-start -- launch auth input opens browser/clipboard and schedules login RPC.
fn handle_launch_auth_input(
    client: &AppServerClient,
    state: &mut AppState,
    action: &InputAction,
    terminal_area: Rect,
    background_tasks: &mut UiTaskQueue,
) -> bool {
    match (state.auth_ui_state(), action) {
        (
            AuthUiState::Starting | AuthUiState::WaitingForBrowser,
            InputAction::Dismiss | InputAction::CancelOrQuit,
        ) => {
            state.cancel_login("Sign in canceled");
            true
        }
        (AuthUiState::SignedOut, InputAction::SubmitPrompt | InputAction::AppendPrompt('l')) => {
            commands::start_login(client.request_handle(), state, background_tasks);
            true
        }
        (AuthUiState::WaitingForBrowser, InputAction::SubmitPrompt) => {
            if let Some(login) = &state.pending_login {
                state.status_line = if commands::open_url(&login.verification_uri_complete).is_ok()
                {
                    "Browser opened for login approval".to_string()
                } else {
                    "Open the login URL manually".to_string()
                };
            }
            true
        }
        (AuthUiState::WaitingForBrowser, InputAction::AppendPrompt('c')) => {
            if let Some(login) = &state.pending_login {
                state.status_line = match crate::clipboard::write_text(&login.user_code) {
                    Ok(()) => "Login code copied".to_string(),
                    Err(error) => format!("Could not copy login code: {error}"),
                };
            }
            true
        }
        (AuthUiState::WaitingForBrowser, InputAction::ClickAt { column, row }) => {
            if let Some(url) = ui::launch_auth_url_at(terminal_area, *column, *row, state) {
                state.status_line = if commands::open_url(&url).is_ok() {
                    "Browser opened for login approval".to_string()
                } else {
                    "Open the login URL manually".to_string()
                };
            }
            true
        }
        (AuthUiState::Checking | AuthUiState::Starting, _) => true,
        (AuthUiState::SignedOut | AuthUiState::WaitingForBrowser, InputAction::AppendPrompt(_)) => {
            true
        }
        (AuthUiState::SignedOut | AuthUiState::WaitingForBrowser, InputAction::PastePrompt(_)) => {
            true
        }
        _ => false,
    }
}
// coverage:ignore-end

// coverage:ignore-start -- dismissal may persist history or respond through live app-server RPC.
async fn handle_dismiss(client: &AppServerClient, state: &mut AppState) {
    if state.picker_active() {
        cancel_picker(state);
    } else if state.effort_selector_active() {
        state.apply(UiAction::EffortSelectorClosed);
    } else if state.model_selector_active() {
        state.apply(UiAction::ModelSelectorClosed);
    } else if state.dismiss_prompt_suggestions() {
    } else if state.raw_output_mode {
        state.raw_output_mode = false;
        state.status_line = "Raw output closed".to_string();
    } else if state.command_output.take().is_some() {
        state.status_line = "Details closed".to_string();
    } else if !state.prompt_input.is_empty() || !state.attachments.is_empty() {
        let now = std::time::Instant::now();
        if state
            .escape_armed_until
            .is_some_and(|deadline| now <= deadline)
        {
            let draft = state.expanded_prompt();
            let recoverable = prompt_history::record_and_persist(client, state, &draft).await;
            state.clear_prompt();
            state.attachments.clear();
            state.escape_armed_until = None;
            state.status_line = if recoverable {
                "Draft cleared; recover it with prompt history"
            } else {
                "Private draft cleared without saving it"
            }
            .to_string();
        } else {
            state.escape_armed_until = Some(now + Duration::from_millis(800));
            state.status_line = "Press Esc again to clear the draft".to_string();
        }
    } else {
        state.escape_armed_until = None;
        state.status_line = "Nothing to dismiss".to_string();
    }
    state.quit_armed_until = None;
}
// coverage:ignore-end

// coverage:ignore-start -- cancellation may send live run/turn/server-request RPC.
async fn handle_cancel_or_quit(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    if state.effort_selector_active()
        || state.model_selector_active()
        || state.picker_active()
        || state.command_suggestions_active()
        || state.file_suggestions_active()
        || state.raw_output_mode
        || state.command_output.is_some()
    {
        handle_dismiss(client, state).await;
        return Ok(());
    }
    if !state.prompt_input.is_empty() || !state.attachments.is_empty() {
        let draft = state.expanded_prompt();
        prompt_history::record_and_persist(client, state, &draft).await;
        state.clear_prompt();
        state.attachments.clear();
        state.status_line = "Draft cleared; press Ctrl-C again to stop or quit".to_string();
        return Ok(());
    }
    if state.active_turn().is_some() {
        let thread_id = state
            .active_thread_id
            .clone()
            .expect("an active turn belongs to an active thread");
        let interrupted = client
            .turn_interrupt(TurnInterruptParams { thread_id })
            .await?;
        state.set_active_thread(interrupted.thread);
        state.status_line = "Interrupted the active task and its background tools".to_string();
        state.quit_armed_until = None;
        return Ok(());
    }
    let active_run_id = state
        .selected_run()
        .filter(|run| matches!(run.status, RunStatus::Queued | RunStatus::Processing))
        .map(|run| run.id.clone())
        .or_else(|| {
            state
                .runs
                .iter()
                .find(|run| matches!(run.status, RunStatus::Queued | RunStatus::Processing))
                .map(|run| run.id.clone())
        });
    if let Some(run_id) = active_run_id {
        let canceled = client.run_cancel(RunIDParams { run_id }).await?;
        state.apply(UiAction::RunCanceled(canceled.run));
        state.quit_armed_until = None;
        return Ok(());
    }
    let now = std::time::Instant::now();
    if state
        .quit_armed_until
        .is_some_and(|deadline| now <= deadline)
    {
        state.apply(UiAction::QuitRequested);
    } else {
        state.quit_armed_until = Some(now + Duration::from_secs(1));
        state.status_line = "Press Ctrl-C again to quit".to_string();
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- prompt submit dispatches command/RPC/background task work.
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
        if state
            .model_selector
            .as_ref()
            .is_some_and(|selector| selector.options.is_empty())
        {
            state.apply(UiAction::ModelSelectorClosed);
            return Ok(());
        }
        match state.model_selector_target() {
            Some(ModelSelectorTarget::Model) => {
                select_highlighted_model(client, state).await?;
            }
            Some(ModelSelectorTarget::Effort) => open_effort_from_model_selector(state),
            Some(ModelSelectorTarget::AgentMode) => state.open_agent_mode_selector(),
            None => {}
        }
        return Ok(());
    }
    if state.focus == FocusArea::Runs && state.prompt_input.trim().is_empty() {
        state.apply(UiAction::LoadSelectedRunIntoPrompt);
        return Ok(());
    }
    state.accept_selected_command_suggestion();
    let prompt = state.expanded_prompt().trim().to_string();
    if prompt.is_empty() {
        state.apply(UiAction::PromptSubmitRejected);
        return Ok(());
    }
    if prompt.starts_with('/') || prompt.starts_with('!') {
        prompt_history::record_and_persist(client, state, &prompt).await;
        handle_local_command(client, state, &prompt, background_tasks).await?;
        return Ok(());
    }
    let persist_history = prompt_history::record(state, &prompt);
    let snapshot = state.clone();
    let submission_id = state.begin_prompt_submission(prompt.clone());
    let request_handle = client.request_handle();
    background_tasks.push(tokio::spawn(async move {
        submit_prompt_in_background(
            request_handle,
            snapshot,
            prompt,
            submission_id,
            persist_history,
        )
        .await
    }));
    Ok(())
}
// coverage:ignore-end

fn open_effort_from_model_selector(state: &mut AppState) {
    let Some(selector) = state.model_selector.as_ref() else {
        return;
    };
    let current_model = selector
        .selected_model_id
        .as_deref()
        .unwrap_or(&selector.default_model_id);
    let Some(option) = selector
        .options
        .iter()
        .find(|option| option.id == current_model)
    else {
        state.status_line = "Current model is unavailable".to_string();
        return;
    };
    if option.reasoning_effort_levels.is_empty() {
        state.status_line = format!("{} has no configurable effort", option.label);
        return;
    }
    let selected_index = state
        .reasoning_effort
        .as_deref()
        .or(option.default_reasoning_effort.as_deref())
        .and_then(|effort| {
            option
                .reasoning_effort_levels
                .iter()
                .position(|candidate| candidate == effort)
        })
        .unwrap_or(0);
    let effort = EffortSelectorState {
        model_id: option.id.clone(),
        levels: option.reasoning_effort_levels.clone(),
        selected_index,
    };
    state.open_nested_effort_selector(effort);
}

// coverage:ignore-start -- task submission pipeline enriches filesystem context and performs live RPC.
async fn submit_prompt_in_background(
    client: AppServerRequestHandle,
    mut state: AppState,
    prompt: String,
    id: u64,
    persist_history: bool,
) -> BackgroundTaskResult {
    if persist_history {
        let history = state.prompt_history.clone();
        prompt_history::persist_with_handle(client.clone(), history).await;
    }

    let outcome = submit_prompt_request(&client, &mut state, prompt)
        .await
        .map_err(|error| match error {
            AppClientError::Rpc { message, .. } => message,
            other => other.to_string(),
        });
    BackgroundTaskResult::PromptSubmission(Box::new(PromptSubmissionResult { id, outcome }))
}

async fn submit_prompt_request(
    client: &AppServerRequestHandle,
    state: &mut AppState,
    prompt: String,
) -> Result<PromptSubmissionOutcome, AppClientError> {
    if let Some(thread_id) = state
        .active_thread_id
        .clone()
        .filter(|_| state.active_turn().is_some())
    {
        let input = features::plan_prompt(
            state,
            prepare_task_prompt_with_handle(client, state, &prompt).await,
        );
        features::run_hooks(state, "prompt_submit").await;
        let steered = client
            .turn_steer(TurnSteerParams {
                thread_id,
                input,
                display_input: Some(prompt),
            })
            .await?;
        return Ok(PromptSubmissionOutcome::Steer(steered.thread));
    }

    if state.task_mode != crate::state::TaskMode::Chat || state.active_thread_id.is_some() {
        if state.active_thread_id.is_none() && !local_runs_allowed() {
            let auth = client.auth_status().await?;
            if !auth.authenticated {
                return Err(AppClientError::Rpc {
                    code: -32_001,
                    message: "Not authenticated. Use /login first.".to_string(),
                });
            }
        }
        return submit_task_prompt_with_handle(client, state, prompt).await;
    }

    if !local_runs_allowed() {
        let auth = client.auth_status().await?;
        if !auth.authenticated {
            return Err(AppClientError::Rpc {
                code: -32_001,
                message: "Not authenticated. Use /login first.".to_string(),
            });
        }
    }
    features::run_hooks(state, "prompt_submit").await;
    let prompt = features::plan_prompt(
        state,
        prepare_task_prompt_with_handle(client, state, &prompt).await,
    );
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
            agent_count: state
                .autonomous_mode_enabled
                .then_some(state.orchestration_agent_count),
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
    Ok(PromptSubmissionOutcome::Run(submitted.run))
}

pub(super) async fn submit_task_prompt(
    client: &AppServerClient,
    state: &mut AppState,
    prompt: String,
) -> Result<(), AppClientError> {
    let outcome = submit_task_prompt_with_handle(&client.request_handle(), state, prompt).await?;
    let PromptSubmissionOutcome::Turn { thread, run } = outcome else {
        unreachable!("task submission always returns a thread outcome")
    };
    state.set_active_thread(thread);
    state.upsert_run(run);
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

async fn submit_task_prompt_with_handle(
    client: &AppServerRequestHandle,
    state: &mut AppState,
    prompt: String,
) -> Result<PromptSubmissionOutcome, AppClientError> {
    let protocol_mode = match state.task_mode {
        crate::state::TaskMode::Chat => taskforceai_app_protocol::TaskMode::Chat,
        crate::state::TaskMode::Work => taskforceai_app_protocol::TaskMode::Work,
        crate::state::TaskMode::Code => taskforceai_app_protocol::TaskMode::Code,
    };
    let expanded_prompt = features::plan_prompt(
        state,
        prepare_task_prompt_with_handle(client, state, &prompt).await,
    );
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
                settings: None,
            })
            .await?;
        let thread_id = started.thread.id.clone();
        state.set_active_thread(started.thread);
        features::run_hooks(state, "session_start").await;
        thread_id
    };
    let attachment_ids = state
        .attachments
        .iter()
        .map(|attachment| attachment.id.clone())
        .collect::<Vec<_>>();
    features::run_hooks(state, "prompt_submit").await;
    let result = client
        .turn_start(TurnStartParams {
            thread_id,
            input: expanded_prompt,
            display_input: Some(prompt),
            model_id: Some(state.current_model_id.clone()),
            reasoning_effort: state.reasoning_effort.clone(),
            quick_mode: Some(
                state.task_mode == crate::state::TaskMode::Chat && state.quick_mode_enabled,
            ),
            autonomous: Some(state.autonomous_mode_enabled),
            computer_use: Some(state.computer_use_enabled),
            use_logged_in_services: None,
            agent_count: state
                .autonomous_mode_enabled
                .then_some(state.orchestration_agent_count),
            project_id: None,
            workspace_root: None,
            attachment_ids,
            client_mcp_tools: Vec::new(),
            client_user_message_id: None,
            permission_profile: None,
        })
        .await?;
    Ok(PromptSubmissionOutcome::Turn {
        thread: result.thread,
        run: result.run,
    })
}

async fn prepare_task_prompt_with_handle(
    client: &AppServerRequestHandle,
    state: &AppState,
    prompt: &str,
) -> String {
    let expanded = expand_workspace_mentions_with_handle(client, state, prompt).await;
    let expanded = crate::skills::enrich_with_available_skills(expanded, &state.skills).await;
    let expanded = if matches!(
        state.task_mode,
        crate::state::TaskMode::Work | crate::state::TaskMode::Code
    ) {
        crate::context::enrich_with_project_instructions(state.workspace.as_deref(), expanded).await
    } else {
        expanded
    };
    if matches!(
        state.task_mode,
        crate::state::TaskMode::Work | crate::state::TaskMode::Code
    ) {
        crate::local_coding::contextualize_prompt(state.workspace.as_deref(), &expanded)
    } else {
        expanded
    }
}
// coverage:ignore-end

// coverage:ignore-start -- reads the host clipboard and uploads attachments through RPC.
async fn paste_clipboard(client: &AppServerClient, state: &mut AppState) {
    match crate::clipboard::read() {
        Ok(crate::clipboard::ClipboardContent::Text(text)) => {
            state.paste_prompt(&text);
            state.status_line = "Pasted clipboard text".to_string();
        }
        Ok(crate::clipboard::ClipboardContent::Image(file)) => {
            match client
                .attachment_add(taskforceai_app_protocol::AttachmentAddParams {
                    path: file.path().display().to_string(),
                })
                .await
            {
                Ok(result) => {
                    state.attachments = result.attachments;
                    state.status_line = "Attached clipboard image".to_string();
                }
                Err(error) => {
                    state.status_line = format!("Clipboard image upload failed: {error}");
                }
            }
        }
        Err(error) => state.status_line = format!("Clipboard paste failed: {error}"),
    }
}
// coverage:ignore-end

#[cfg(test)]
// coverage:ignore-start -- expands workspace file mentions through live app-server file RPC.
pub(super) async fn expand_workspace_mentions(
    client: &AppServerClient,
    state: &AppState,
    prompt: &str,
) -> String {
    expand_workspace_mentions_with_handle(&client.request_handle(), state, prompt).await
}

async fn expand_workspace_mentions_with_handle(
    client: &AppServerRequestHandle,
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
// coverage:ignore-end

// coverage:ignore-start -- submits approval/form responses to the live app-server.
async fn handle_interaction_input(
    client: &AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    let response = match action {
        InputAction::Dismiss | InputAction::CancelOrQuit => state.cancel_interaction(),
        #[cfg(test)]
        InputAction::Quit => state.cancel_interaction(),
        InputAction::SubmitPrompt => {
            let persistent_rule = state.pending_interaction.as_ref().and_then(|interaction| {
                let decision = match interaction.selected_option()?.value.as_str() {
                    "alwaysAllow" => crate::permissions::RuleDecision::Allow,
                    "alwaysDeny" => crate::permissions::RuleDecision::Deny,
                    _ => return None,
                };
                Some((interaction.approval_target.clone()?, decision))
            });
            if let Some((target, decision)) = persistent_rule {
                if let Err(error) = crate::permissions::persist_default_rule(
                    state.workspace.as_deref(),
                    &target,
                    decision,
                )
                .await
                {
                    state.status_line = format!("Could not save permission rule: {error}");
                    return Ok(());
                }
            }
            match state.submit_interaction() {
                Ok(response) => response,
                Err(message) => {
                    state.status_line = message;
                    None
                }
            }
        }
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
        InputAction::PasteClipboard => {
            if let Ok(crate::clipboard::ClipboardContent::Text(value)) = crate::clipboard::read() {
                state.paste_interaction_input(&value);
            }
            None
        }
        _ => None,
    };
    if let Some((request_id, result)) = response {
        client.respond_server_request(request_id, result).await?;
    }
    Ok(())
}
// coverage:ignore-end

#[cfg(test)]
mod coverage_tests {
    use taskforceai_app_protocol::ModelOptionRecord;

    use super::*;
    use crate::state::ModelSelectorState;
    use crate::test_support::initialized;

    fn option(levels: &[&str], default: Option<&str>) -> ModelOptionRecord {
        ModelOptionRecord {
            id: "model".to_string(),
            label: "Model".to_string(),
            badge: String::new(),
            description: None,
            usage_multiple: None,
            reasoning_effort_levels: levels.iter().map(|level| (*level).to_string()).collect(),
            default_reasoning_effort: default.map(ToOwned::to_owned),
        }
    }

    #[test]
    fn nested_effort_selector_covers_missing_fixed_and_configurable_models() {
        let mut state = AppState::new(initialized(), Vec::new());
        open_effort_from_model_selector(&mut state);

        state.model_selector = Some(ModelSelectorState {
            options: Vec::new(),
            default_model_id: "missing".to_string(),
            selected_model_id: None,
            selected_index: 0,
            remote_catalog: false,
        });
        open_effort_from_model_selector(&mut state);
        assert_eq!(state.status_line, "Current model is unavailable");

        state.model_selector.as_mut().unwrap().options = vec![option(&[], None)];
        state.model_selector.as_mut().unwrap().default_model_id = "model".to_string();
        open_effort_from_model_selector(&mut state);
        assert!(state.status_line.contains("no configurable effort"));

        state.model_selector.as_mut().unwrap().options =
            vec![option(&["low", "high"], Some("high"))];
        open_effort_from_model_selector(&mut state);
        let selector = state.effort_selector.as_ref().expect("effort selector");
        assert_eq!(selector.selected_index, 1);
        assert_eq!(selector.model_id, "model");
    }
}
