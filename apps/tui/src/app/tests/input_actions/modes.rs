use super::*;

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn input_actions_cover_disabled_toggles_and_local_runs() {
    let _guard = APP_ENV_TEST_LOCK.lock().expect("app env test lock");
    let previous = std::env::var_os("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", "1");
    let (base_url, server, requests) = start_recording_rpc_sequence_server(vec![
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
    let requests = requests.lock().expect("captured requests");
    let submitted = requests
        .iter()
        .find(|request| request["method"] == "run.submit")
        .expect("run submission");
    assert_eq!(submitted["params"]["quickMode"], false);
    assert_eq!(submitted["params"]["autonomous"], false);
    assert_eq!(submitted["params"]["computerUse"], true);
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn private_chat_submit_marks_interactive_run_private() {
    let _guard = APP_ENV_TEST_LOCK.lock().expect("app env test lock");
    let previous = std::env::var_os("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", "1");
    let (base_url, server) = start_rpc_capture_server(
        "run.submit",
        json!({"run": run_json("private", RunStatus::Queued)}),
    );
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.private_chat_enabled = true;
    state.prompt_input = "private prompt".to_string();
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
    .expect("private run submit should succeed");

    if let Some(previous) = previous {
        std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", previous);
    } else {
        std::env::remove_var("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    }
    let request = server.join().expect("run.submit rpc should finish");
    assert_eq!(request["params"]["privateChat"], true);
    assert_eq!(state.selected_run_id(), Some("private"));
}

#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn work_submission_uses_threads_without_enabling_agent_teams_and_supports_steer_queue() {
    let _guard = APP_ENV_TEST_LOCK.lock().expect("app env test lock");
    let previous = std::env::var_os("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    std::env::remove_var("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    let thread_without_turn = json!({
        "id": "thread-work",
        "title": "Plan launch",
        "objective": "Plan launch",
        "state": "active",
        "archived": false,
        "source": "tui",
        "taskMode": "work",
        "parentThreadId": null,
        "turns": [],
        "createdAt": 1,
        "updatedAt": 1
    });
    let turn = json!({
        "id": "turn-work",
        "threadId": "thread-work",
        "runId": "run-work",
        "status": "in_progress",
        "items": [],
        "createdAt": 1,
        "updatedAt": 1
    });
    let mut thread_with_turn = thread_without_turn.clone();
    thread_with_turn["turns"] = json!([turn.clone()]);
    let queued = json!({
        "id": 9,
        "conversationId": "run-work",
        "prompt": "send the summary",
        "status": "queued",
        "dispatchTiming": "after_response",
        "createdAt": 2,
        "updatedAt": 2,
        "modelId": "default",
        "reasoningEffort": null,
        "attachmentIds": []
    });
    let (base_url, server, requests) = start_recording_rpc_sequence_server(vec![
        (
            "auth.status",
            json!({"authenticated": true, "user": {"id": "u1"}}),
        ),
        (
            "thread/start",
            json!({"thread": thread_without_turn, "turn": null}),
        ),
        (
            "turn/start",
            json!({
                "thread": thread_with_turn.clone(),
                "turn": turn.clone(),
                "run": run_json("run-work", RunStatus::Processing)
            }),
        ),
        (
            "turn/steer",
            json!({"thread": thread_with_turn, "turn": turn}),
        ),
        (
            "promptQueue.add",
            json!({"queuedPrompt": queued, "run": null}),
        ),
        (
            "attachment.clear",
            json!({"attachments": [], "maxAttachments": 5}),
        ),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.task_mode = crate::state::TaskMode::Work;
    let area = Rect::new(0, 0, 120, 30);
    let mut tasks = UiTaskQueue::new();
    let mut dictation = SpaceDictationState::Idle;

    state.paste_prompt("Plan launch");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("Work task should start");
    assert_eq!(state.task_mode, crate::state::TaskMode::Work);
    assert_eq!(state.status_line, "Started Work task");

    state.paste_prompt("focus on risks");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("active task should steer");
    assert_eq!(state.status_line, "Steered the active task");

    state.paste_prompt("send the summary");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::QueuePromptAfterResponse,
        area,
        &mut tasks,
        &mut dictation,
    )
    .await
    .expect("follow-up should queue");
    server.join().expect("rpc sequence should finish");

    let requests = requests.lock().expect("captured requests");
    let thread_start = requests
        .iter()
        .find(|request| request["method"] == "thread/start")
        .expect("thread start request");
    assert_eq!(thread_start["params"]["taskMode"], "work");
    let turn_start = requests
        .iter()
        .find(|request| request["method"] == "turn/start")
        .expect("turn start request");
    assert_eq!(turn_start["params"]["autonomous"], false);
    assert_eq!(turn_start["params"]["quickMode"], false);
    assert!(turn_start["params"]["agentCount"].is_null());
    let queued = requests
        .iter()
        .find(|request| request["method"] == "promptQueue.add")
        .expect("queue request");
    assert_eq!(queued["params"]["dispatchTiming"], "after_response");

    if let Some(previous) = previous {
        std::env::set_var("TASKFORCEAI_ALLOW_LOCAL_RUNS", previous);
    } else {
        std::env::remove_var("TASKFORCEAI_ALLOW_LOCAL_RUNS");
    }
}
