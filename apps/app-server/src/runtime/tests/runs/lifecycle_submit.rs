use super::*;

#[tokio::test]
async fn authenticated_remote_submit_prefers_stored_computer_use_mode() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "task_id": "remote_task_1", "status": "processing" }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .computer_use_mode_set(RunModeSetParams { enabled: true })
        .expect("computer use mode should persist");

    runtime
        .run_submit(SubmitRunParams {
            quick_mode: Some(true),
            computer_use: Some(false),
            ..submit_run_params("use the desktop")
        })
        .await
        .expect("remote submit should succeed");

    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["options"]["quickModeEnabled"], false);
    assert_eq!(body["options"]["computerUseEnabled"], true);
    assert_eq!(body["options"]["computerUseTarget"], "virtual");
}

#[tokio::test]
async fn pending_prompt_replay_preserves_original_prompt_when_remote_submit_fails() {
    let (base_url, server, _requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response("not json".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    let now = unix_millis();
    runtime
        .pending_prompt_add(PendingPromptRecord {
            id: "pending_original".to_string(),
            prompt: "retry remote once".to_string(),
            model_id: Some("gpt-test".to_string()),
            reasoning_effort: None,
            project_id: Some(9),
            status: PendingPromptStatus::Queued,
            retry_count: 2,
            last_error: Some("previous error".to_string()),
            created_at: now,
            updated_at: now,
        })
        .expect("pending prompt add should work");

    let replayed = result_value(
        runtime
            .pending_prompt_replay()
            .await
            .expect("replay should return failed run metadata"),
    );

    assert_eq!(replayed["attempted"], true);
    assert_eq!(replayed["prompt"]["id"], "pending_original");
    assert_eq!(replayed["prompt"]["status"], "failed");
    assert_eq!(replayed["prompt"]["retryCount"], 3);
    assert_eq!(replayed["run"]["status"], "failed");
    assert_eq!(replayed["remaining"], 1);
    let pending = result_value(runtime.pending_prompt_list());
    let prompts = pending["prompts"]
        .as_array()
        .expect("prompts should be array");
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0]["id"], "pending_original");

    server.join().expect("mock submit server should exit");
}

#[tokio::test]
async fn pending_prompt_replay_marks_invalid_prompt_failed() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime.pending_prompts.insert(
        "pending_invalid".to_string(),
        PendingPromptRecord {
            id: "pending_invalid".to_string(),
            prompt: "   ".to_string(),
            model_id: None,
            reasoning_effort: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        },
    );

    let replayed = result_value(
        runtime
            .pending_prompt_replay()
            .await
            .expect("invalid pending prompt should return failed replay result"),
    );

    assert_eq!(replayed["attempted"], true);
    assert_eq!(replayed["run"], Value::Null);
    assert_eq!(replayed["prompt"]["status"], "failed");
    assert_eq!(replayed["prompt"]["retryCount"], 1);
    assert!(replayed["prompt"]["lastError"]
        .as_str()
        .expect("last error")
        .contains("prompt is required"));
}

#[tokio::test]
async fn authenticated_remote_submit_rejects_local_computer_use_target() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let err = runtime
        .run_submit(SubmitRunParams {
            computer_use: Some(true),
            computer_use_target: Some(ComputerUseTarget::Local),
            ..submit_run_params("use this mac")
        })
        .await
        .expect_err("local computer-use target should fail closed");

    assert!(
        err.to_string()
            .contains("local Computer Use requires an authorized desktop capability"),
        "{err}"
    );
}

#[tokio::test]
async fn submit_rejects_reasoning_effort_for_unsupported_models() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let err = runtime
        .run_submit(SubmitRunParams {
            model_id: Some("openai/gpt-4".to_string()),
            reasoning_effort: Some("high".to_string()),
            ..submit_run_params("reason about this")
        })
        .await
        .expect_err("unsupported reasoning effort model should fail");

    assert_eq!(err.code, -32602);
    assert!(
        err.to_string()
            .contains("does not support configurable reasoning effort"),
        "{err}"
    );
}

#[tokio::test]
async fn submit_rejects_unsupported_reasoning_effort_levels() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let err = runtime
        .run_submit(SubmitRunParams {
            model_id: Some("openai/gpt-5.6-sol".to_string()),
            reasoning_effort: Some("extreme".to_string()),
            ..submit_run_params("reason about this")
        })
        .await
        .expect_err("unsupported reasoning effort level should fail");

    assert_eq!(err.code, -32602);
    assert!(
        err.to_string().contains("is not supported by model"),
        "{err}"
    );
}

#[tokio::test]
async fn authenticated_remote_submit_auto_routes_image_generation() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "task_id": "remote_task_1", "status": "processing" }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");

    runtime
        .run_submit(SubmitRunParams {
            reasoning_effort: Some("high".to_string()),
            quick_mode: Some(false),
            agent_count: Some(4),
            ..submit_run_params("Create an image of a launch control room")
        })
        .await
        .expect("remote submit should succeed");

    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["modelId"], "google/gemini-2.5-flash-image");
    assert_eq!(body["options"]["quickModeEnabled"], true);
    assert_eq!(body["options"]["agentCount"], 1);
    assert!(body["options"].get("computerUseEnabled").is_none());
    assert!(body.get("reasoningEffort").is_none());
}

#[tokio::test]
async fn authenticated_remote_submit_preserves_explicit_model_for_attachment_prompt() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "task_id": "remote_task_1", "status": "processing" }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");

    runtime
        .run_submit(SubmitRunParams {
            model_id: Some("openai/gpt-5".to_string()),
            quick_mode: Some(false),
            agent_count: Some(4),
            attachment_ids: vec!["att-1".to_string()],
            ..submit_run_params("Please edit this attached document and summarize the changes")
        })
        .await
        .expect("remote submit should succeed");

    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["modelId"], "openai/gpt-5");
    assert_eq!(body["attachment_ids"][0], "att-1");
}

#[tokio::test]
async fn authenticated_remote_submit_auto_routes_video_generation_over_computer_use() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "task_id": "remote_task_1", "status": "processing" }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .computer_use_mode_set(RunModeSetParams { enabled: true })
        .expect("computer use mode should persist");

    runtime
        .run_submit(SubmitRunParams {
            quick_mode: Some(false),
            computer_use: Some(true),
            agent_count: Some(4),
            attachment_ids: vec!["att-1".to_string()],
            ..submit_run_params("Generate a two second video of a red circle moving left to right")
        })
        .await
        .expect("remote submit should succeed");

    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["modelId"], "xai/grok-imagine-video-1.5");
    assert_eq!(body["attachment_ids"][0], "att-1");
    assert_eq!(body["options"]["quickModeEnabled"], true);
    assert_eq!(body["options"]["agentCount"], 1);
    assert!(body["options"].get("computerUseEnabled").is_none());
}

#[tokio::test]
async fn empty_prompt_is_invalid() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let err = runtime
        .run_submit(submit_run_params("  "))
        .await
        .expect_err("empty prompt should fail");

    assert_eq!(err.code, -32602);
}

#[tokio::test]
async fn cancel_updates_run_status() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("hello"))
        .await
        .expect("submit should succeed");

    let response = runtime
        .run_cancel(RunIDParams {
            run_id: "local_run_1".to_string(),
        })
        .expect("cancel should succeed");

    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["status"], "canceled");

    let stored = result_value(
        runtime
            .run_status(RunIDParams {
                run_id: "local_run_1".to_string(),
            })
            .expect("canceled run status should be readable"),
    );
    assert_eq!(stored["run"]["status"], "canceled");

    let repeated = runtime
        .run_cancel(RunIDParams {
            run_id: "local_run_1".to_string(),
        })
        .expect("repeated cancel should be idempotent");
    let AppResponse::WithEvents { result, events } = repeated else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["status"], "canceled");
    assert!(events.is_empty());
}

#[tokio::test]
async fn cancel_rejects_completed_and_failed_runs_without_rewriting_status() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("already terminal"))
        .await
        .expect("submit should succeed");

    for status in [RunStatus::Completed, RunStatus::Failed] {
        runtime
            .runs
            .get_mut("local_run_1")
            .expect("run should exist")
            .status = status.clone();
        let error = runtime
            .run_cancel(RunIDParams {
                run_id: "local_run_1".to_string(),
            })
            .expect_err("terminal run cancellation should fail");
        assert_eq!(error.code, -32602);
        assert_eq!(
            runtime
                .get_run("local_run_1")
                .expect("run should remain")
                .status,
            status
        );
    }
}

#[tokio::test]
async fn remote_cancel_marks_run_and_dispatches_cancel_request() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "ok": true }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime.runs.insert(
        "task_cancel_remote".to_string(),
        RunRecord {
            id: "task_cancel_remote".to_string(),
            prompt: "cancel remote".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Processing,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );

    let canceled = result_value(
        runtime
            .run_cancel(RunIDParams {
                run_id: "task_cancel_remote".to_string(),
            })
            .expect("remote cancel should update local run"),
    );
    assert_eq!(canceled["run"]["status"], "canceled");

    for _ in 0..50 {
        if requests.lock().expect("requests lock").len() >= 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    server.join().expect("mock cancel server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].path, "/api/auth/csrf");
    assert_eq!(requests[1].method, "POST");
    assert_eq!(requests[1].path, "/tasks/task_cancel_remote/cancel");
}

#[test]
fn missing_run_returns_not_found() {
    let runtime = AppRuntime::new(RuntimeConfig::default());
    let err = runtime
        .run_status(RunIDParams {
            run_id: "missing".to_string(),
        })
        .expect_err("missing run should fail");

    assert_eq!(err.code, -32004);
}
