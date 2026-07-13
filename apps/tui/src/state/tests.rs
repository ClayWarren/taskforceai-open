use std::time::Instant;

use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginPollResult, DeviceLoginStartResult, InitializeResult,
    ModelListResult, ModelOptionRecord, PendingPromptReplayResult, RunRecord, RunStatus,
    SyncRealtimePollResult, ThreadItemRecord, ThreadRecord, TurnRecord, TurnStatus,
    WorkflowRunRecord, WorkflowRunState,
};

use super::{AppState, EffortSelectorState, FocusArea, UiAction};
use crate::test_support::{all_capabilities, initialized_with_capabilities};

fn initialized() -> InitializeResult {
    let mut capabilities = all_capabilities();
    capabilities.mcp = false;
    initialized_with_capabilities(capabilities)
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

fn turn(id: &str, status: TurnStatus) -> TurnRecord {
    TurnRecord {
        id: id.to_string(),
        thread_id: "thread".to_string(),
        run_id: id.to_string(),
        status,
        items: Vec::new(),
        created_at: 1,
        updated_at: 1,
    }
}

#[test]
fn run_submitted_upserts_run() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "hello".to_string();

    state.apply(UiAction::RunSubmitted(run("r1", RunStatus::Queued)));
    state.apply(UiAction::RunSubmitted(run("r1", RunStatus::Canceled)));

    assert_eq!(state.runs.len(), 1);
    assert_eq!(state.runs[0].status, RunStatus::Canceled);
    assert_eq!(state.selected_run_id(), Some("r1"));
    assert!(state.prompt_input.is_empty());
}

#[test]
fn private_chat_mode_defaults_off_and_updates_status() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "/private on".to_string();

    assert!(!state.private_chat_enabled);
    state.apply(UiAction::PrivateChatSet(true));

    assert!(state.private_chat_enabled);
    assert_eq!(state.status_line, "Private Chat enabled");
    assert!(state.prompt_input.is_empty());
    assert!(state
        .command_output
        .as_deref()
        .expect("private chat output")
        .contains("won't appear in your history"));

    state.apply(UiAction::PrivateChatSet(false));

    assert!(!state.private_chat_enabled);
    assert_eq!(state.status_line, "Private Chat disabled");
}

#[test]
fn server_event_updates_run() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    state.apply(UiAction::ServerEvent(AppServerEvent::RunUpdated {
        run: Box::new(run("r1", RunStatus::Canceled)),
    }));

    assert_eq!(state.runs[0].status, RunStatus::Canceled);
    assert!(state.status_line.contains("canceled"));
}

#[test]
fn tick_and_server_delete_events_update_state() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    state.apply(UiAction::Tick);
    assert_eq!(state.animation_frame, 1);

    state.apply(UiAction::ServerEvent(AppServerEvent::RunDeleted {
        run_id: "r1".to_string(),
    }));
    assert!(state.runs.is_empty());
    assert_eq!(
        state.status_line,
        "Conversation deleted from app-server event"
    );
}

#[test]
fn server_event_noop_variants_do_not_change_status() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.status_line = "steady".to_string();

    state.apply(UiAction::ServerEvent(AppServerEvent::TurnStarted {
        thread_id: "thread".to_string(),
        turn: Box::new(turn("turn-started", TurnStatus::InProgress)),
    }));
    state.apply(UiAction::ServerEvent(AppServerEvent::TurnInterrupted {
        thread_id: "thread".to_string(),
        turn: Box::new(turn("turn-interrupted", TurnStatus::Interrupted)),
    }));
    state.apply(UiAction::ServerEvent(AppServerEvent::TurnUpdated {
        thread_id: "thread".to_string(),
        turn: Box::new(turn("turn-updated", TurnStatus::InProgress)),
    }));
    state.apply(UiAction::ServerEvent(AppServerEvent::TurnCompleted {
        thread_id: "thread".to_string(),
        turn: Box::new(turn("turn-completed", TurnStatus::Completed)),
    }));
    let item = || -> ThreadItemRecord {
        serde_json::from_value(serde_json::json!({
            "id":"item", "turnId":"item-turn", "type":"agentMessage", "status":"completed",
            "content":{"text":"done"}, "createdAt":1, "updatedAt":2
        }))
        .expect("item")
    };
    for event in [
        AppServerEvent::ItemStarted {
            thread_id: "thread".into(),
            turn_id: "item-turn".into(),
            item: Box::new(item()),
        },
        AppServerEvent::ItemUpdated {
            thread_id: "thread".into(),
            turn_id: "item-turn".into(),
            item: Box::new(item()),
        },
        AppServerEvent::ItemCompleted {
            thread_id: "thread".into(),
            turn_id: "item-turn".into(),
            item: Box::new(item()),
        },
    ] {
        state.apply(UiAction::ServerEvent(event));
    }
    let thread: ThreadRecord = serde_json::from_value(serde_json::json!({
        "id":"thread", "title":"Updated", "objective":"", "state":"active", "archived":false,
        "source":"test", "taskMode":"work", "parentThreadId":null, "turns":[],
        "createdAt":1, "updatedAt":2
    }))
    .expect("thread");
    state.apply(UiAction::ServerEvent(AppServerEvent::ThreadUpdated {
        thread: Box::new(thread),
    }));
    state.apply(UiAction::ServerEvent(AppServerEvent::ServerRequest {
        request: taskforceai_app_protocol::JsonRpcServerRequest {
            jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
            id: serde_json::json!(9),
            method: "unsupported".into(),
            params: serde_json::json!({}),
        },
    }));
    assert_eq!(state.status_line, "Unsupported interaction");
    state.apply(UiAction::ServerEvent(AppServerEvent::WorkflowRunUpdated {
        run: Box::new(WorkflowRunRecord {
            run_id: "workflow-run".to_string(),
            workflow_id: "workflow".to_string(),
            workflow_version: "1.0.0".to_string(),
            state: WorkflowRunState::Running,
            args: serde_json::json!({}),
            phase_runs: Vec::new(),
            agent_run_ids: Vec::new(),
            output: None,
            error: None,
            created_at: 1,
            updated_at: 2,
        }),
    }));

    assert_eq!(state.status_line, "Unsupported interaction");
    assert_eq!(state.active_thread_id.as_deref(), Some("thread"));
}

#[test]
fn quit_action_sets_shutdown_state() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::QuitRequested);

    assert!(state.should_quit);
}

#[test]
fn selection_moves_through_runs() {
    let mut state = AppState::new(
        initialized(),
        vec![
            run("r1", RunStatus::Queued),
            run("r2", RunStatus::Queued),
            run("r3", RunStatus::Queued),
        ],
    );

    assert_eq!(state.selected_run_id(), Some("r1"));
    state.apply(UiAction::SelectNextRun);
    assert_eq!(state.selected_run_id(), Some("r2"));
    state.apply(UiAction::SelectPreviousRun);
    assert_eq!(state.selected_run_id(), Some("r1"));
}

#[test]
fn focus_and_detail_scroll_are_stateful() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    assert_eq!(state.focus, FocusArea::Prompt);
    state.apply(UiAction::ToggleFocus);
    assert_eq!(state.focus, FocusArea::Runs);
    assert_eq!(state.status_line, "Conversation focus");

    state.apply(UiAction::ScrollDetailsDown);
    assert_eq!(state.detail_scroll_offset, 10);
    state.apply(UiAction::ScrollDetailsUp);
    assert_eq!(state.detail_scroll_offset, 0);
}

#[test]
fn sidebar_toggle_collapses_and_restores_conversation_list() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);
    state.apply(UiAction::ToggleFocus);

    state.apply(UiAction::ToggleSidebar);

    assert!(state.sidebar_collapsed);
    assert_eq!(state.focus, FocusArea::Prompt);
    assert_eq!(state.status_line, "Conversation sidebar collapsed");

    state.apply(UiAction::ToggleFocus);
    assert_eq!(state.focus, FocusArea::Prompt);
    assert_eq!(state.status_line, "Conversation sidebar collapsed");

    state.apply(UiAction::ToggleSidebar);
    assert!(!state.sidebar_collapsed);
    assert_eq!(state.status_line, "Conversation sidebar expanded");
}

#[test]
fn run_canceled_updates_selected_run() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    state.apply(UiAction::RunCanceled(run("r1", RunStatus::Canceled)));

    assert_eq!(state.runs[0].status, RunStatus::Canceled);
    assert_eq!(state.selected_run_id(), Some("r1"));
}

#[test]
fn run_deleted_removes_selected_run() {
    let mut state = AppState::new(
        initialized(),
        vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
    );

    state.apply(UiAction::RunDeleted("r1".to_string()));

    assert_eq!(state.runs.len(), 1);
    assert_eq!(state.selected_run_id(), Some("r2"));
}

#[test]
fn deleting_selected_run_keeps_selection_near_deleted_position() {
    let runs = (0..20)
        .map(|index| run(&format!("r{index}"), RunStatus::Queued))
        .collect::<Vec<_>>();
    let mut state = AppState::new(initialized(), runs);

    state.apply(UiAction::SelectRunAtIndex(12));
    state.apply(UiAction::RunDeleted("r12".to_string()));

    assert_eq!(state.runs.len(), 19);
    assert_eq!(state.selected_run_id(), Some("r13"));
}

#[test]
fn deleting_last_selected_run_selects_previous_run() {
    let runs = (0..3)
        .map(|index| run(&format!("r{index}"), RunStatus::Queued))
        .collect::<Vec<_>>();
    let mut state = AppState::new(initialized(), runs);

    state.apply(UiAction::SelectRunAtIndex(2));
    state.apply(UiAction::RunDeleted("r2".to_string()));

    assert_eq!(state.selected_run_id(), Some("r1"));
}

#[test]
fn prompt_editing_updates_input_buffer() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::AppendPrompt('h'));
    state.apply(UiAction::AppendPrompt('i'));
    state.apply(UiAction::BackspacePrompt);

    assert_eq!(state.prompt_input, "h");
}

#[test]
fn slash_input_updates_command_suggestions() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::AppendPrompt('/'));
    state.apply(UiAction::AppendPrompt('s'));

    assert_eq!(state.selected_command_suggestion, Some(0));
    assert!(state.command_suggestions.contains(&"/status"));
    assert!(state.command_suggestions.contains(&"/sync"));

    state.apply(UiAction::BackspacePrompt);
    state.apply(UiAction::BackspacePrompt);

    assert!(state.command_suggestions.is_empty());
    assert_eq!(state.selected_command_suggestion, None);
}

#[test]
fn command_catalog_hides_redundant_aliases() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.set_authenticated(true);

    state.prompt_input = "/".to_string();
    state.refresh_command_suggestions();

    assert!(state.command_suggestions.contains(&"/quit"));
    assert!(state.command_suggestions.contains(&"/clear"));
    assert!(state.command_suggestions.contains(&"/new"));
    assert!(state.command_suggestions.contains(&"/voice"));
    assert!(state.command_suggestions.contains(&"/private"));
    assert!(state.command_suggestions.contains(&"/artifacts"));
    assert!(state.command_suggestions.contains(&"/reset-local"));
    assert!(!state.command_suggestions.contains(&"/exit"));
    assert!(!state.command_suggestions.contains(&"/reset"));
}

#[test]
fn private_command_suggestion_requires_authentication() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.prompt_input = "/p".to_string();
    state.refresh_command_suggestions();

    assert!(!state.command_suggestions.contains(&"/private"));

    state.set_authenticated(true);

    assert!(state.command_suggestions.contains(&"/private"));

    state.private_chat_enabled = true;
    state.set_authenticated(false);

    assert!(!state.private_chat_enabled);
    assert!(!state.command_suggestions.contains(&"/private"));
}

#[test]
fn clear_and_new_are_ui_only_actions() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);
    state.prompt_input = "/clear".to_string();
    state.command_output = Some("Status\nok".to_string());

    state.apply(UiAction::ClearScreen);
    assert!(state.prompt_input.is_empty());
    assert!(state.command_output.is_none());
    assert_eq!(state.selected_run_id(), Some("r1"));

    state.apply(UiAction::NewPrompt);
    assert!(state.prompt_input.is_empty());
    assert!(state.command_output.is_none());
    assert_eq!(state.selected_run_id(), None);
}

#[test]
fn current_model_defaults_and_updates() {
    let mut state = AppState::new(initialized(), Vec::new());

    assert_eq!(state.current_model_id, "default");
    state.set_current_model("zai/glm-5.2");
    assert_eq!(state.current_model_id, "zai/glm-5.2");
    state.set_current_model("   ");
    assert_eq!(state.current_model_id, "default");
}

#[test]
fn model_selector_opens_and_moves_selection() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::ModelSelectorOpened(ModelListResult {
        enabled: true,
        options: vec![
            ModelOptionRecord {
                id: "model-a".to_string(),
                label: "Model A".to_string(),
                badge: "default".to_string(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
            ModelOptionRecord {
                id: "model-b".to_string(),
                label: "Model B".to_string(),
                badge: "pro".to_string(),
                description: None,
                usage_multiple: Some(2.0),
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
        ],
        default_model_id: "model-a".to_string(),
        selected_model_id: Some("model-b".to_string()),
        remote_catalog: false,
    }));

    assert!(state.model_selector_active());
    assert_eq!(state.current_model_id, "model-b");
    assert_eq!(
        state
            .selected_model_option()
            .map(|option| option.id.as_str()),
        Some("model-b")
    );

    state.apply(UiAction::SelectPreviousModel);
    assert_eq!(
        state
            .selected_model_option()
            .map(|option| option.id.as_str()),
        Some("model-a")
    );

    state.apply(UiAction::ModelSelectorClosed);
    assert!(!state.model_selector_active());
}

#[test]
fn reasoning_effort_selector_moves_confirms_and_resets_on_model_change() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.set_current_model("openai/gpt-5.6-sol");

    state.apply(UiAction::SelectPreviousEffort);
    state.apply(UiAction::EffortSelectorOpened(EffortSelectorState {
        model_id: "openai/gpt-5.6-sol".to_string(),
        levels: Vec::new(),
        selected_index: 3,
    }));
    state.apply(UiAction::SelectNextEffort);
    assert_eq!(state.selected_effort(), None);
    state.apply(UiAction::EffortSelectorClosed);
    assert!(!state.effort_selector_active());

    state.apply(UiAction::EffortSelectorOpened(EffortSelectorState {
        model_id: "openai/gpt-5.6-sol".to_string(),
        levels: vec!["low", "medium", "high", "xhigh", "max"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        selected_index: 1,
    }));

    assert!(state.effort_selector_active());
    assert_eq!(state.selected_effort(), Some("medium"));
    state.apply(UiAction::SelectNextEffort);
    assert_eq!(state.selected_effort(), Some("high"));
    state.apply(UiAction::ReasoningEffortSet(Some("high".to_string())));
    assert_eq!(state.reasoning_effort.as_deref(), Some("high"));
    assert!(!state.effort_selector_active());

    state.set_current_model("xai/grok-4.5");
    assert_eq!(state.reasoning_effort, None);
}

#[test]
fn history_loaded_replaces_runs_and_selects_first() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::HistoryLoaded(vec![
        run("r1", RunStatus::Completed),
        run("r2", RunStatus::Queued),
    ]));

    assert_eq!(state.runs.len(), 2);
    assert_eq!(state.selected_run_id(), Some("r1"));
    assert_eq!(state.status_line, "Loaded history");
}

#[test]
fn command_suggestions_can_be_selected_and_accepted() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::AppendPrompt('/'));
    assert!(state.command_suggestions_active());
    assert_eq!(state.selected_command_suggestion, Some(0));

    state.apply(UiAction::SelectNextCommandSuggestion);
    assert_eq!(state.selected_command_suggestion, Some(1));

    state.apply(UiAction::SelectPreviousCommandSuggestion);
    assert_eq!(state.selected_command_suggestion, Some(0));
    state.apply(UiAction::SelectPreviousCommandSuggestion);
    assert_eq!(
        state.selected_command_suggestion,
        Some(state.command_suggestions.len().saturating_sub(1))
    );

    assert!(state.accept_selected_command_suggestion());
    assert_eq!(
        state.prompt_input,
        state.command_suggestions[state.selected_command_suggestion.unwrap()]
    );
}

#[test]
fn command_suggestion_acceptance_preserves_arguments() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "/mod set ollama/gemma4:e4b".to_string();
    state.prompt_cursor = state.prompt_input.len();
    state.apply(UiAction::AppendPrompt(' '));

    assert!(state.command_suggestions.contains(&"/model"));
    assert!(state.accept_selected_command_suggestion());
    assert_eq!(state.prompt_input, "/model set ollama/gemma4:e4b");
}

#[test]
fn command_suggestion_edges_ignore_empty_and_stale_selection() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::SelectNextCommandSuggestion);
    assert_eq!(state.selected_command_suggestion, None);

    state.prompt_input = "/m".to_string();
    state.refresh_command_suggestions();
    state.selected_command_suggestion = Some(999);
    assert!(!state.accept_selected_command_suggestion());
}

#[test]
fn rejected_submit_keeps_prompt_buffer() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::PromptSubmitRejected);

    assert_eq!(state.status_line, "Type a prompt before submitting");
}

#[test]
fn voice_transcript_appends_or_replaces_prompt() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "existing".to_string();

    state.apply(UiAction::ApplyVoiceTranscript {
        transcript: "voice words".to_string(),
        replace: false,
    });

    assert_eq!(state.prompt_input, "existing voice words");
    assert_eq!(state.status_line, "Voice transcript ready");

    state.apply(UiAction::ApplyVoiceTranscript {
        transcript: "replacement".to_string(),
        replace: true,
    });

    assert_eq!(state.prompt_input, "replacement");
}

#[test]
fn command_output_replaces_prompt_buffer() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "/status".to_string();

    state.apply(UiAction::CommandExecuted {
        title: "Status".to_string(),
        message: "ok".to_string(),
    });

    assert!(state.prompt_input.is_empty());
    assert_eq!(state.command_output.as_deref(), Some("Status\nok"));
}

#[test]
fn command_output_displayed_preserves_prompt_buffer() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.prompt_input = "draft prompt".to_string();

    state.apply(UiAction::CommandOutputDisplayed {
        title: "Update".to_string(),
        message: "Done".to_string(),
    });

    assert_eq!(state.prompt_input, "draft prompt");
    assert_eq!(state.command_output.as_deref(), Some("Update\nDone"));
}

#[test]
fn selecting_runs_clears_stale_command_output() {
    let mut state = AppState::new(
        initialized(),
        vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
    );
    state.command_output = Some("Status\nold output".to_string());

    state.apply(UiAction::SelectNextRun);

    assert_eq!(state.selected_run_id(), Some("r2"));
    assert!(state.command_output.is_none());

    state.command_output = Some("Status\nold output".to_string());
    state.apply(UiAction::SelectRunAtIndex(0));

    assert_eq!(state.selected_run_id(), Some("r1"));
    assert!(state.command_output.is_none());
}

#[test]
fn login_started_tracks_pending_poll() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
        device_code: "device-code".to_string(),
        user_code: "ABCD-1234".to_string(),
        verification_uri: "https://example.test/device".to_string(),
        verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
        expires_in: 600,
        interval: 5,
    }));

    assert_eq!(
        state.due_login_device_code(Instant::now()),
        None,
        "fresh login should not poll immediately"
    );
    assert!(state.pending_login.is_some());
    assert!(state
        .command_output
        .as_deref()
        .expect("login command output")
        .contains("ABCD-1234"));
}

#[test]
fn expired_login_stops_polling() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
        device_code: "device-code".to_string(),
        user_code: "ABCD-1234".to_string(),
        verification_uri: "https://example.test/device".to_string(),
        verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
        expires_in: 1,
        interval: 5,
    }));
    let expired_at = state
        .pending_login
        .as_ref()
        .expect("pending login")
        .expires_at;

    assert!(state.login_expired(expired_at));
    assert_eq!(state.due_login_device_code(expired_at), None);

    state.mark_login_expired();

    assert!(state.pending_login.is_none());
    assert_eq!(state.status_line, "Login expired");
}

#[test]
fn approved_login_poll_clears_pending_state() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
        device_code: "device-code".to_string(),
        user_code: "ABCD-1234".to_string(),
        verification_uri: "https://example.test/device".to_string(),
        verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
        expires_in: 600,
        interval: 5,
    }));
    state.apply(UiAction::LoginPolled(DeviceLoginPollResult {
        status: "approved".to_string(),
        token: Some("token".to_string()),
        expires_in: Some(3600),
        interval: None,
        message: None,
    }));

    assert!(state.pending_login.is_none());
    assert_eq!(state.status_line, "Authenticated");
}

#[test]
fn login_poll_pending_failure_and_terminal_status_edges() {
    let mut state = AppState::new(initialized(), Vec::new());
    state.apply(UiAction::LoginStarted(DeviceLoginStartResult {
        device_code: "device-code".to_string(),
        user_code: "ABCD-1234".to_string(),
        verification_uri: "https://example.test/device".to_string(),
        verification_uri_complete: "https://example.test/device?code=ABCD-1234".to_string(),
        expires_in: 600,
        interval: 5,
    }));

    state.apply(UiAction::LoginPolled(DeviceLoginPollResult {
        status: "pending".to_string(),
        token: None,
        expires_in: None,
        interval: Some(0),
        message: None,
    }));
    assert!(state.pending_login.is_some());
    assert_eq!(state.status_line, "Waiting for login approval");

    state.mark_login_poll_failed("Login poll failed: offline");
    assert_eq!(state.status_line, "Login poll failed: offline");

    state.apply(UiAction::LoginPolled(DeviceLoginPollResult {
        status: "denied".to_string(),
        token: None,
        expires_in: None,
        interval: None,
        message: None,
    }));
    assert!(state.pending_login.is_none());
    assert_eq!(
        state.command_output.as_deref(),
        Some("Login\nStatus: denied")
    );
    assert_eq!(state.status_line, "Login ended");
}

#[test]
fn sync_realtime_poll_tracks_cursor_and_due_time() {
    let mut state = AppState::new(initialized(), Vec::new());
    assert_eq!(state.due_sync_last_event_id(Instant::now()), None);

    state.next_sync_poll_at = Instant::now();
    assert_eq!(state.due_sync_last_event_id(Instant::now()), Some(None));

    state.apply(UiAction::SyncRealtimePolled(SyncRealtimePollResult {
        has_updates: true,
        last_event_id: "42-0".to_string(),
    }));

    assert_eq!(state.last_sync_event_id.as_deref(), Some("42-0"));
    assert_eq!(state.status_line, "Sync updates detected");
    assert_eq!(state.due_sync_last_event_id(Instant::now()), None);
}

#[test]
fn sync_and_pending_replay_failure_edges_reschedule() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.mark_sync_poll_failed("Sync poll failed: offline");
    assert_eq!(state.status_line, "Sync poll failed: offline");
    assert_eq!(state.due_sync_last_event_id(Instant::now()), None);

    state.apply(UiAction::SyncRealtimePolled(SyncRealtimePollResult {
        has_updates: false,
        last_event_id: "   ".to_string(),
    }));
    assert_eq!(state.last_sync_event_id, None);

    state.mark_pending_replay_failed("Pending replay failed: offline");
    assert_eq!(state.status_line, "Pending replay failed: offline");
    assert!(!state.pending_replay_due(Instant::now()));

    state.apply(UiAction::PendingPromptReplayed(Box::new(
        PendingPromptReplayResult {
            attempted: false,
            prompt: None,
            run: None,
            remaining: 0,
            message: "Nothing replayed.".to_string(),
        },
    )));
    assert_eq!(state.status_line, "Pending replay failed: offline");
}

#[test]
fn pending_prompt_replay_upserts_returned_run_and_reschedules() {
    let mut state = AppState::new(initialized(), Vec::new());
    assert!(!state.pending_replay_due(Instant::now()));

    state.next_pending_replay_at = Instant::now();
    assert!(state.pending_replay_due(Instant::now()));

    state.apply(UiAction::PendingPromptReplayed(Box::new(
        PendingPromptReplayResult {
            attempted: true,
            prompt: None,
            run: Some(run("r-pending", RunStatus::Queued)),
            remaining: 0,
            message: "Pending prompt replayed.".to_string(),
        },
    )));

    assert_eq!(state.runs.len(), 1);
    assert_eq!(state.selected_run_id(), Some("r-pending"));
    assert_eq!(state.status_line, "Pending prompt replayed.");
    assert!(!state.pending_replay_due(Instant::now()));
}

#[test]
fn pending_prompt_replay_respects_server_capability() {
    let mut initialized = initialized();
    initialized.capabilities.pending_prompts = false;
    let mut state = AppState::new(initialized, Vec::new());
    state.next_pending_replay_at = Instant::now();

    assert!(!state.pending_replay_due(Instant::now()));
}

#[test]
fn empty_run_selection_and_loading_edges_update_status() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::SelectNextRun);
    assert_eq!(state.selected_run_id(), None);
    assert_eq!(state.status_line, "No conversations to select");

    state.apply(UiAction::LoadSelectedRunIntoPrompt);
    assert_eq!(state.status_line, "No selected conversation to continue");
}

#[test]
fn selected_run_can_be_loaded_into_prompt() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    state.apply(UiAction::LoadSelectedRunIntoPrompt);

    assert_eq!(state.prompt_input, "hello");
    assert_eq!(state.focus, FocusArea::Prompt);
    assert_eq!(
        state.status_line,
        "Loaded selected conversation into prompt"
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("load output")
        .contains("Loaded the selected prompt"));
}

#[test]
fn stale_selection_is_recovered_or_reset() {
    let mut state = AppState::new(
        initialized(),
        vec![
            run("r1", RunStatus::Queued),
            run("r2", RunStatus::Queued),
            run("r3", RunStatus::Queued),
        ],
    );
    state.selected_run_id = Some("r3".to_string());
    state.selected_run_index = Some(99);

    assert_eq!(state.selected_run_index(), Some(2));
    assert_eq!(state.selected_run().map(|run| run.id.as_str()), Some("r3"));

    state.apply(UiAction::RunDeleted("missing".to_string()));
    assert_eq!(state.selected_run_index(), Some(2));

    state.selected_run_id = Some("gone".to_string());
    state.selected_run_index = Some(99);
    state.apply(UiAction::RunDeleted("missing".to_string()));
    assert_eq!(state.selected_run_id(), Some("r1"));
    assert_eq!(state.selected_run_index(), Some(0));
}

#[test]
fn empty_model_selector_and_missing_removed_run_edges() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);
    state.apply(UiAction::SelectNextModel);
    assert!(state.selected_model_option().is_none());

    state.apply(UiAction::ModelSelectorOpened(ModelListResult {
        enabled: true,
        options: Vec::new(),
        default_model_id: "default".to_string(),
        selected_model_id: None,
        remote_catalog: false,
    }));
    state.apply(UiAction::SelectNextModel);
    assert!(state.selected_model_option().is_none());

    state.apply(UiAction::ModelSelectorClosed);
    state.selected_run_id = Some("missing".to_string());
    state.selected_run_index = Some(0);
    state.apply(UiAction::RunDeleted("r1".to_string()));
    assert_eq!(state.selected_run_id(), None);
    assert_eq!(state.selected_run_index(), None);
}

#[test]
fn pending_login_without_state_and_missing_selection_fallback_edges() {
    let mut state = AppState::new(
        initialized(),
        vec![
            run("r1", RunStatus::Queued),
            run("r2", RunStatus::Queued),
            run("r3", RunStatus::Queued),
        ],
    );

    state.apply(UiAction::LoginPolled(DeviceLoginPollResult {
        status: "pending".to_string(),
        token: None,
        expires_in: None,
        interval: Some(2),
        message: None,
    }));
    assert!(state.pending_login.is_none());

    state.selected_run_id = Some("r3".to_string());
    state.selected_run_index = Some(0);
    state.apply(UiAction::RunDeleted("r2".to_string()));
    assert_eq!(state.selected_run_id(), Some("r3"));
    assert_eq!(state.selected_run_index(), Some(1));

    state.selected_run_id = Some("missing".to_string());
    state.selected_run_index = Some(0);
    state.apply(UiAction::RunDeleted("r1".to_string()));
    assert_eq!(state.selected_run_id(), Some("r3"));
    assert_eq!(state.selected_run_index(), Some(0));

    state.selected_run_id = None;
    state.selected_run_index = None;
    state.apply(UiAction::RunDeleted("r3".to_string()));
    assert_eq!(state.selected_run_id(), None);
    assert_eq!(state.selected_run_index(), None);

    let mut no_selection = AppState::new(
        initialized(),
        vec![run("a", RunStatus::Queued), run("b", RunStatus::Queued)],
    );
    no_selection.selected_run_id = None;
    no_selection.selected_run_index = None;
    no_selection.apply(UiAction::RunDeleted("a".to_string()));
    assert_eq!(no_selection.selected_run_id(), Some("b"));
    assert_eq!(no_selection.selected_run_index(), Some(0));
}

#[test]
fn deleting_non_selected_run_preserves_adjusted_selection() {
    let mut state = AppState::new(
        initialized(),
        vec![
            run("r1", RunStatus::Queued),
            run("r2", RunStatus::Queued),
            run("r3", RunStatus::Queued),
        ],
    );
    state.selected_run_id = Some("r3".to_string());
    state.selected_run_index = Some(2);

    state.apply(UiAction::RunDeleted("r1".to_string()));

    assert_eq!(state.selected_run_id(), Some("r3"));
    assert_eq!(state.selected_run_index(), Some(1));
}

#[test]
fn prompt_and_voice_edges_ignore_empty_input() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.apply(UiAction::AppendPrompt('\n'));
    assert_eq!(state.prompt_input, "");

    state.apply(UiAction::ApplyVoiceTranscript {
        transcript: "   ".to_string(),
        replace: false,
    });
    assert_eq!(state.status_line, "Voice transcript was empty");
    assert_eq!(state.prompt_input, "");
}
