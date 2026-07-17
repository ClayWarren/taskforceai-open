use super::*;

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

    state.apply(UiAction::LoginPolled {
        attempt_id: 99,
        result: DeviceLoginPollResult {
            status: "pending".to_string(),
            token: None,
            expires_in: None,
            interval: Some(2),
            message: None,
        },
    });
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
