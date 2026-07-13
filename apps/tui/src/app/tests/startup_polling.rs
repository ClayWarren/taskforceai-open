use super::*;

#[tokio::test]
async fn startup_hydration_and_due_polling_use_app_server_results() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("status.summary", status_summary_json()),
        (
            "history.list",
            json!({"runs": [run_json("history", RunStatus::Completed)]}),
        ),
        ("thread/list", json!({"threads": []})),
        (
            "attachment.list",
            json!({"attachments": [], "maxAttachments": 5}),
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
                "conversations": [{
                    "conversationId": "first",
                    "title": "First",
                    "createdAt": 1,
                    "updatedAt": 1,
                    "lastMessagePreview": null
                }],
                "messages": [{
                    "messageId": "first-message",
                    "conversationId": "first",
                    "role": "user",
                    "content": "First",
                    "createdAt": 1,
                    "updatedAt": 1
                }],
                "deletions": [],
                "hasMore": true
            }),
        ),
        (
            "sync.pull",
            json!({
                "deviceId": "device",
                "latestVersion": 3,
                "conversations": [{
                    "conversationId": "second",
                    "title": "Second",
                    "createdAt": 2,
                    "updatedAt": 2,
                    "lastMessagePreview": null
                }],
                "messages": [{
                    "messageId": "second-message",
                    "conversationId": "second",
                    "role": "assistant",
                    "content": "Second",
                    "createdAt": 2,
                    "updatedAt": 2
                }],
                "deletions": [],
                "hasMore": false
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
        "Sync pulled 2 conversations and 2 messages"
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
async fn sync_history_refresh_errors_stay_in_status_line() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "sync.realtimePoll",
            json!({"hasUpdates": true, "lastEventId": "evt-4"}),
        ),
        (
            "sync.pull",
            json!({
                "deviceId": "device",
                "latestVersion": 4,
                "conversations": [],
                "messages": [],
                "deletions": []
            }),
        ),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.next_sync_poll_at = Instant::now();

    poll_sync_if_due(&mut client, &mut state)
        .await
        .expect("history refresh error should be absorbed");

    assert_eq!(state.last_sync_event_id.as_deref(), Some("evt-4"));
    assert!(state.status_line.contains("Sync history refresh failed"));
    server.join().expect("rpc sequence should finish");
}

#[test]
fn background_task_result_and_space_helpers_cover_edges() {
    let mut state = crate::state::AppState::new(initialized(), Vec::new());

    apply_background_task_result(
        &mut state,
        BackgroundTaskResult::Ui(Box::new(UiAction::CommandOutputDisplayed {
            title: "Task".to_string(),
            message: "done".to_string(),
        })),
    );
    assert_eq!(state.command_output.as_deref(), Some("Task\ndone"));

    apply_background_task_result(
        &mut state,
        BackgroundTaskResult::RealtimeVoice(Ok(RealtimeTurnResult {
            user_transcript: Some("hello".to_string()),
            assistant_transcript: Some("hi".to_string()),
        })),
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Realtime Voice\nYou: hello\nTaskForceAI: hi")
    );

    state.prompt_input = "a b".to_string();
    remove_pending_space(&mut state, 1);
    assert_eq!(state.prompt_input, "ab");
    remove_pending_space(&mut state, 1);
    assert_eq!(state.prompt_input, "ab");
    remove_pending_space(&mut state, 10);
    assert_eq!(state.prompt_input, "ab");
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

    let failed = startup_update_result(Err(UpdateError::MissingAsset("archive".to_string()))).await;
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
