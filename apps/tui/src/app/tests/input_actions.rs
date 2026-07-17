use super::*;

#[tokio::test]
async fn model_selector_opens_and_applies_polished_agent_team_configuration() {
    let orchestration = json!({
        "orchestration": {
            "roles": [{
                "name": "Researcher",
                "description": "Find supporting evidence",
                "modelId": null
            }],
            "budget": null
        }
    });
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("autonomousMode.set", json!({"enabled": true})),
        ("metadata.set", json!({})),
        ("orchestration.get", orchestration),
        (
            "model.list",
            serde_json::to_value(model_list(Some("gpt-5"))).expect("model list should serialize"),
        ),
        (
            "orchestration.clear",
            json!({"orchestration": {"roles": [], "budget": null}}),
        ),
        ("metadata.set", json!({})),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.apply(UiAction::ModelSelectorOpened(model_list(Some("gpt-5"))));
    state
        .model_selector
        .as_mut()
        .expect("model selector")
        .selected_index = 3;
    let area = Rect::new(0, 0, 120, 30);
    let mut tasks: UiTaskQueue = FuturesUnordered::new();
    let mut space_dictation = SpaceDictationState::Idle;

    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("agent mode should open");
    assert!(state.agent_mode_selector_active());

    for action in [
        InputAction::SelectNextRun,
        InputAction::SubmitPrompt,
        InputAction::SelectNextRun,
        InputAction::SubmitPrompt,
        InputAction::SelectNextRun,
        InputAction::SubmitPrompt,
    ] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("agent team control should respond");
    }
    assert!(state.autonomous_mode_enabled);
    assert_eq!(state.orchestration_agent_count, 6);
    assert!(state.team_config_active());

    state
        .team_config
        .as_mut()
        .expect("team config")
        .selected_index = 3;
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("team configuration should apply");
    assert!(!state.team_config_active());
    assert_eq!(
        state.status_line,
        "Custom Agent Teams configuration applied"
    );
    server.join().expect("rpc server should finish");
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
        ("metadata.set", json!({})),
        ("auth.status", json!({"authenticated": false, "user": null})),
        ("metadata.set", json!({})),
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
            serde_json::to_value(model_list(Some("gpt-5"))).expect("model list should serialize"),
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
    assert!(state.prompt_input.is_empty());
    assert_eq!(
        state
            .pending_submission
            .as_ref()
            .map(|submission| submission.display_prompt.as_str()),
        Some("needs auth")
    );
    apply_next_background_task(&mut state, &mut tasks).await;
    assert_eq!(
        state.command_output.as_deref(),
        Some(
            "Submission Failed\nNot authenticated. Use /login first.\nYour prompt was restored for retry."
        )
    );

    state.prompt_input = "ship it".to_string();
    state.prompt_cursor = state.prompt_input.len();
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
    assert!(state.selected_run_id().is_none());
    assert!(state.pending_submission.is_some());
    apply_next_background_task(&mut state, &mut tasks).await;
    assert_eq!(state.selected_run_id(), Some("submitted"));
    assert_eq!(state.status_line, "Submitted prompt");

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

    assert!(state.sidebar_collapsed);
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::ToggleSidebar,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("sidebar toggle should expand conversations");
    assert!(!state.sidebar_collapsed);

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
        InputAction::ToggleSidebar,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("sidebar toggle should collapse conversations");
    assert!(state.sidebar_collapsed);
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::ToggleSidebar,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("sidebar toggle should expand conversations");
    assert!(!state.sidebar_collapsed);

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

    state.apply(UiAction::ToggleFocus);
    assert_eq!(state.focus, FocusArea::Runs);
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
    state.prompt_cursor = state.prompt_input.len();
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
    assert_eq!(state.status_line, "No selected conversation to cancel");
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
    assert_eq!(state.status_line, "No selected conversation to delete");

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
            column: 48,
            row: footer_row,
        },
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("footer sidebar click should be handled");
    assert!(!state.sidebar_collapsed);
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::ClickAt {
            column: 105,
            row: footer_row,
        },
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("footer dismiss click should be handled");
    assert!(!state.should_quit);

    for _ in 0..2 {
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::CancelOrQuit,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("idle Ctrl-C should be handled contextually");
    }
    assert!(state.should_quit);

    server.join().expect("empty rpc sequence should finish");
}

#[tokio::test]
async fn input_actions_cover_reasoning_effort_selector() {
    let (base_url, server) = start_rpc_sequence_server(Vec::new());
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    let area = Rect::new(0, 0, 120, 30);
    let mut tasks: UiTaskQueue = FuturesUnordered::new();
    let mut space_dictation = SpaceDictationState::Idle;
    let selector = crate::state::EffortSelectorState {
        model_id: "openai/gpt-5.6-sol".to_string(),
        levels: vec!["low".to_string(), "medium".to_string(), "high".to_string()],
        selected_index: 1,
    };

    state.apply(UiAction::EffortSelectorOpened(selector.clone()));
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::Quit,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("quit should close effort selector");
    assert!(!state.effort_selector_active());

    state.apply(UiAction::EffortSelectorOpened(selector));
    for action in [
        InputAction::SelectPreviousRun,
        InputAction::SelectNextRun,
        InputAction::MovePromptLeft,
        InputAction::MovePromptRight,
    ] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("effort navigation should succeed");
    }

    let prompt_before = state.prompt_input.clone();
    for action in [
        InputAction::ClickAt { column: 1, row: 1 },
        InputAction::BackspacePrompt,
        InputAction::AppendPrompt('x'),
        InputAction::SpaceDictationPressed,
    ] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut space_dictation,
        )
        .await
        .expect("effort selector should absorb editing actions");
    }
    assert_eq!(state.prompt_input, prompt_before);

    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut space_dictation,
    )
    .await
    .expect("submit should confirm effort");
    assert_eq!(state.reasoning_effort.as_deref(), Some("medium"));
    assert!(!state.effort_selector_active());

    server.join().expect("empty rpc sequence should finish");
}

#[tokio::test]
async fn input_actions_cover_raw_edit_history_file_and_interaction_paths() {
    let (base_url, server) = start_rpc_sequence_server(Vec::new());
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.task_mode = crate::state::TaskMode::Chat;
    let area = Rect::new(0, 0, 120, 30);
    let mut tasks = UiTaskQueue::new();
    let mut dictation = SpaceDictationState::Idle;

    for action in [InputAction::ToggleRawOutput, InputAction::ToggleRawOutput] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut dictation,
        )
        .await
        .expect("raw output toggle");
    }
    state.paste_prompt("first\nsecond");
    state.record_prompt_history("older");
    for action in [
        InputAction::MovePromptHome,
        InputAction::MovePromptEnd,
        InputAction::MovePromptLeft,
        InputAction::MovePromptRight,
        InputAction::InsertPromptNewline,
        InputAction::DeletePrompt,
        InputAction::SelectPreviousRun,
        InputAction::SelectNextRun,
        InputAction::PastePrompt(" pasted".into()),
    ] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut dictation,
        )
        .await
        .expect("prompt edit/history action");
    }

    state.clear_prompt();
    state.paste_prompt("review @src");
    state.set_file_suggestions(vec!["src/main.rs".into(), "src/lib.rs".into()]);
    for action in [InputAction::SelectNextRun, InputAction::SelectPreviousRun] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut dictation,
        )
        .await
        .expect("file suggestion navigation");
    }
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("file suggestion acceptance");
    assert!(state.prompt_input.contains("@src/main.rs"));

    state.clear_prompt();
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::QueuePromptAfterResponse,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("empty queue rejection");
    state.paste_prompt("follow up");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::QueuePromptAfterResponse,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("missing conversation rejection");

    state
        .open_interaction(taskforceai_app_protocol::JsonRpcServerRequest {
            jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
            id: json!(7),
            method: "item/tool/requestUserInput".into(),
            params: json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "questions":[
                    {"id":"choice","header":"Choice","question":"Pick","options":[{"label":"A","description":"A"}]},
                    {"id":"note","header":"Note","question":"Text","options":[]}
                ]
            }),
        })
        .expect("interaction");
    for action in [
        InputAction::SelectNextRun,
        InputAction::SelectPreviousRun,
        InputAction::MovePromptRight,
        InputAction::MovePromptLeft,
        InputAction::ScrollDetailsUp,
        InputAction::ScrollDetailsDown,
        InputAction::SubmitPrompt,
        InputAction::PastePrompt("answer".into()),
        InputAction::BackspacePrompt,
        InputAction::AppendPrompt('r'),
        InputAction::ToggleSidebar,
    ] {
        handle_input_action(
            &mut client,
            &mut state,
            action,
            area,
            &mut tasks,
            &mut dictation,
        )
        .await
        .expect("interaction action");
    }
    state.pending_interaction = None;

    state.focus = FocusArea::Runs;
    state.clear_prompt();
    for value in ['k', 'j', 'x', 'q'] {
        handle_input_action(
            &mut client,
            &mut state,
            InputAction::AppendPrompt(value),
            area,
            &mut tasks,
            &mut dictation,
        )
        .await
        .expect("runs keyboard shortcut");
        if value == 'x' {
            state.clear_prompt();
            state.focus = FocusArea::Runs;
        }
    }
    assert!(state.should_quit);
    server.join().expect("empty server");
}

#[tokio::test]
async fn picker_input_filters_and_resumes_the_selected_mode() {
    let resumed = json!({
        "id":"code-thread", "title":"Code task", "objective":"Build picker",
        "state":"active", "archived":false, "source":"tui", "taskMode":"code",
        "parentThreadId":null, "turns":[], "createdAt":1, "updatedAt":2
    });
    let (base_url, server) = start_rpc_sequence_server(vec![(
        "thread/resume",
        json!({"thread": resumed, "turn": null}),
    )]);
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.open_picker(
        crate::state::PickerKind::Resume,
        "Resume",
        vec![
            crate::state::PickerOption::new("chat-thread", "Chat", "chat", "notes"),
            crate::state::PickerOption::new("code-thread", "Code task", "code", "picker"),
        ],
        None,
    );
    let area = Rect::new(0, 0, 120, 30);
    let mut tasks: UiTaskQueue = FuturesUnordered::new();
    let mut dictation = SpaceDictationState::Idle;

    handle_input_action(
        &mut client,
        &mut state,
        InputAction::PastePrompt("picker".to_string()),
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("filter picker");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("resume selected thread");

    assert!(!state.picker_active());
    assert_eq!(state.active_thread_id.as_deref(), Some("code-thread"));
    assert_eq!(state.task_mode, crate::state::TaskMode::Code);
    server.join().expect("resume rpc");
}

mod modes;
