use std::time::Instant;

use taskforceai_app_protocol::{
    AppServerEvent, Capabilities, DeviceLoginPollResult, DeviceLoginStartResult, InitializeResult,
    ModelListResult, ModelOptionRecord, PendingPromptReplayResult, RunRecord, RunStatus,
    ServerInfo, SyncRealtimePollResult, TransportInfo,
};

use super::{AppState, FocusArea, UiAction};

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
            mcp: false,
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
fn server_event_updates_run() {
    let mut state = AppState::new(initialized(), vec![run("r1", RunStatus::Queued)]);

    state.apply(UiAction::ServerEvent(AppServerEvent::RunUpdated {
        run: Box::new(run("r1", RunStatus::Canceled)),
    }));

    assert_eq!(state.runs[0].status, RunStatus::Canceled);
    assert!(state.status_line.contains("canceled"));
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

    state.apply(UiAction::ScrollDetailsDown);
    assert_eq!(state.detail_scroll_offset, 10);
    state.apply(UiAction::ScrollDetailsUp);
    assert_eq!(state.detail_scroll_offset, 0);
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
    assert!(state.command_suggestions.contains(&"/status".to_string()));
    assert!(state.command_suggestions.contains(&"/sync".to_string()));

    state.apply(UiAction::BackspacePrompt);
    state.apply(UiAction::BackspacePrompt);

    assert!(state.command_suggestions.is_empty());
    assert_eq!(state.selected_command_suggestion, None);
}

#[test]
fn command_catalog_hides_redundant_aliases() {
    let mut state = AppState::new(initialized(), Vec::new());

    state.prompt_input = "/".to_string();
    state.refresh_command_suggestions();

    assert!(state.command_suggestions.contains(&"/quit".to_string()));
    assert!(state.command_suggestions.contains(&"/clear".to_string()));
    assert!(state.command_suggestions.contains(&"/new".to_string()));
    assert!(state.command_suggestions.contains(&"/voice".to_string()));
    assert!(state
        .command_suggestions
        .contains(&"/reset-local".to_string()));
    assert!(!state.command_suggestions.contains(&"/exit".to_string()));
    assert!(!state.command_suggestions.contains(&"/reset".to_string()));
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
    state.set_current_model("moonshotai/kimi-k2.6");
    assert_eq!(state.current_model_id, "moonshotai/kimi-k2.6");
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
            },
            ModelOptionRecord {
                id: "model-b".to_string(),
                label: "Model B".to_string(),
                badge: "pro".to_string(),
                description: None,
                usage_multiple: Some(2.0),
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
    state.apply(UiAction::AppendPrompt(' '));

    assert!(state
        .command_suggestions
        .iter()
        .any(|command| command == "/model"));
    assert!(state.accept_selected_command_suggestion());
    assert_eq!(state.prompt_input, "/model set ollama/gemma4:e4b");
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
fn pending_prompt_replay_upserts_returned_run_and_reschedules() {
    let mut state = AppState::new(initialized(), Vec::new());
    assert!(!state.pending_replay_due(Instant::now()));

    state.next_pending_replay_at = Instant::now();
    assert!(state.pending_replay_due(Instant::now()));

    state.apply(UiAction::PendingPromptReplayed(PendingPromptReplayResult {
        attempted: true,
        prompt: None,
        run: Some(run("r-pending", RunStatus::Queued)),
        remaining: 0,
        message: "Pending prompt replayed.".to_string(),
    }));

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
