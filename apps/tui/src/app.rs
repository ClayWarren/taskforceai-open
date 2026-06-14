use std::env;
use std::time::Duration;

use crossterm::event::{Event as CrosstermEvent, EventStream};
use futures_util::{stream::FuturesUnordered, StreamExt};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    AppServerEvent, HistoryListParams, PromptQueueDispatchAfterResponseParams, QuickModeSetParams,
    RunIDParams, RunModeSetParams, RunStatus, SubmitRunParams,
};
use tokio::task::JoinHandle;
use tokio::time;

use crate::input::{map_key_event, map_mouse_event, InputAction};
use crate::state::{AppState, FocusArea, UiAction};
use crate::ui;
use crate::update;

mod commands;
pub(crate) mod format;
mod polling;

use commands::handle_local_command;
use polling::{poll_login_if_due, poll_sync_if_due, replay_pending_prompt_if_due};

pub(super) type UiTaskQueue = FuturesUnordered<JoinHandle<UiAction>>;

pub async fn run_event_loop(
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
) -> Result<(), AppClientError> {
    let mut reader = EventStream::new();
    let mut tick = time::interval(Duration::from_millis(250));
    let mut startup_hydrated = false;
    let mut startup_update = startup_update_task();
    let mut background_tasks: UiTaskQueue = FuturesUnordered::new();

    while !state.should_quit {
        terminal
            .draw(|frame| ui::render(frame, state))
            .map_err(AppClientError::Read)?;

        tokio::select! {
            maybe_event = reader.next() => {
                if let Some(Ok(event)) = maybe_event {
                    let action = match event {
                        CrosstermEvent::Key(key) => map_key_event(key),
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
                            handle_input_action(client, state, action, area, &mut background_tasks).await
                        {
                            apply_interactive_error(state, err);
                        }
                    }
                }
            }
            maybe_result = background_tasks.next() => {
                if let Some(result) = maybe_result {
                    match result {
                        Ok(action) => state.apply(action),
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
                Ok(()) => StartupUpdateResult {
                    command_output: Some(format!(
                        "Update\nUpdated to {latest_version}. Restart TaskForceAI to use the new version."
                    )),
                    status_line: "Updated TaskForceAI; restart to complete".to_string(),
                },
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
                        ))
                        .await?;
                    }
                    ui::FooterAction::Quit => state.apply(UiAction::QuitRequested),
                }
            }
        }
        InputAction::BackspacePrompt => state.apply(UiAction::BackspacePrompt),
        InputAction::AppendPrompt(value) => handle_character_input(state, value),
    }
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
    use taskforceai_app_client::AppClientError;
    use taskforceai_app_protocol::{
        AppServerEvent, Capabilities, InitializeResult, ModelListResult, ModelOptionRecord,
        OllamaMemoryRecommendation, OllamaStatusResult, RunRecord, RunStatus, ServerInfo,
        TransportInfo,
    };

    use super::format::{format_model_list, format_ollama_status};
    use super::{after_response_conversation_id, apply_interactive_error, handle_character_input};
    use crate::state::{FocusArea, UiAction};

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
        handle_character_input(&mut state, 'q');
        assert!(state.should_quit);

        let mut prompt_state = crate::state::AppState::new(initialized(), Vec::new());
        assert_eq!(prompt_state.focus, FocusArea::Prompt);
        handle_character_input(&mut prompt_state, 'q');
        assert_eq!(prompt_state.prompt_input, "q");
        assert!(!prompt_state.should_quit);
    }
}
