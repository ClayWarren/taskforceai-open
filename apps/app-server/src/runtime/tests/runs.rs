use super::support::{
    json_response, result_value, start_recording_response_sequence_server, submit_run_params,
    test_store_path, MockHttpResponse,
};
use super::*;
use crate::protocol::{ComputerUseTarget, RunModeSetParams};
use crate::runtime::RuntimeError;

#[tokio::test]
async fn submit_run_creates_history_record_and_event() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let response = runtime
        .run_submit(SubmitRunParams {
            model_id: Some("sentinel".to_string()),
            project_id: Some(12),
            ..submit_run_params("hello")
        })
        .await
        .expect("submit should succeed");

    let AppResponse::WithEvents { result, events } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["id"], "local_run_1");
    assert_eq!(result["run"]["status"], "queued");
    assert_eq!(events.len(), 1);

    let AppResponse::Value(history) = runtime.history_list(HistoryListParams { limit: 10 }) else {
        panic!("expected history response");
    };
    assert_eq!(history["runs"][0]["prompt"], "hello");
}

#[tokio::test]
async fn history_list_returns_runs_by_recent_update_time() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime.runs.insert(
        "local_run_10".to_string(),
        RunRecord {
            id: "local_run_10".to_string(),
            prompt: "older lexicographic winner".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: None,
            error: None,
            created_at: 10,
            updated_at: 10,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );
    runtime.runs.insert(
        "task_recent".to_string(),
        RunRecord {
            id: "task_recent".to_string(),
            prompt: "newest by timestamp".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: None,
            error: None,
            created_at: 20,
            updated_at: 20,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );

    let history = result_value(runtime.history_list(HistoryListParams { limit: 10 }));

    assert_eq!(history["runs"][0]["id"], "task_recent");
}

#[tokio::test]
async fn authenticated_remote_submit_sends_selected_options_and_uses_remote_id() {
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime
        .orchestration_set_role(OrchestrationRoleSetParams {
            role: "researcher".to_string(),
            model_id: "gpt-5".to_string(),
        })
        .expect("role should update");
    runtime
        .orchestration_set_budget(OrchestrationBudgetSetParams { budget: 25.0 })
        .expect("budget should update");
    runtime
        .mcp_add(McpServerAddParams {
            name: "files".to_string(),
            endpoint: "https://example.com/mcp".to_string(),
            tools: vec!["read".to_string()],
            enabled: true,
        })
        .expect("mcp server should configure");

    let submitted = result_value(
        runtime
            .run_submit(SubmitRunParams {
                model_id: Some("gpt-5".to_string()),
                quick_mode: Some(true),
                autonomous: Some(true),
                computer_use: Some(true),
                project_id: Some(42),
                agent_count: Some(1),
                attachment_ids: vec!["att-1".to_string()],
                ..submit_run_params("send remote")
            })
            .await
            .expect("remote submit should succeed"),
    );

    assert_eq!(submitted["run"]["id"], "remote_task_1");
    assert_eq!(submitted["run"]["status"], "processing");
    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].method, "POST");
    assert_eq!(requests[1].path, "/run");
    assert_eq!(
        requests[1].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["prompt"], "send remote");
    assert_eq!(body["modelId"], "gpt-5");
    assert_eq!(body["projectId"], 42);
    assert_eq!(body["attachment_ids"][0], "att-1");
    assert_eq!(body["role_models"]["Researcher"], "gpt-5");
    assert_eq!(body["budget"], 25.0);
    assert_eq!(body["options"]["quickModeEnabled"], false);
    assert_eq!(body["options"]["autonomyEnabled"], true);
    assert_eq!(body["options"]["computerUseEnabled"], true);
    assert_eq!(body["options"]["computerUseTarget"], "virtual");
    assert_eq!(body["options"]["agentCount"], 1);
    assert_eq!(
        body["options"]["clientTools"]["mcp"][0]["serverName"],
        "files"
    );
}

#[tokio::test]
async fn remote_submit_api_error_returns_failed_run_and_queues_pending_prompt() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let response = runtime
        .run_submit(submit_run_params("queue on remote failure"))
        .await
        .expect("submit failures are returned as failed runs");
    let AppResponse::WithEvents { result, events } = response else {
        panic!("expected failed submit with events");
    };

    assert_eq!(result["run"]["status"], "failed");
    assert!(result["run"]["error"]
        .as_str()
        .expect("error should be present")
        .contains("api error"));
    assert_eq!(events.len(), 1);
    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(pending["prompts"][0]["prompt"], "queue on remote failure");
    assert_eq!(pending["prompts"][0]["status"], "queued");

    server.join().expect("mock submit server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/run");
}

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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    let now = unix_millis();
    runtime
        .pending_prompt_add(PendingPromptRecord {
            id: "pending_original".to_string(),
            prompt: "retry remote once".to_string(),
            model_id: Some("gpt-test".to_string()),
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    runtime
        .run_submit(SubmitRunParams {
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime
        .computer_use_mode_set(RunModeSetParams { enabled: true })
        .expect("computer use mode should persist");

    runtime
        .run_submit(SubmitRunParams {
            quick_mode: Some(false),
            computer_use: Some(true),
            agent_count: Some(4),
            ..submit_run_params("Generate a two second video of a red circle moving left to right")
        })
        .await
        .expect("remote submit should succeed");

    server.join().expect("mock submit server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["modelId"], "xai/grok-imagine-video");
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
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
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

#[tokio::test]
async fn command_execute_searches_local_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("find this prompt"))
        .await
        .expect("submit should succeed");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/search find".to_string(),
            })
            .await
            .expect("search command should succeed"),
    );

    assert!(result["message"]
        .as_str()
        .expect("message should be string")
        .contains("find this prompt"));
}

#[tokio::test]
async fn run_search_returns_matching_local_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("structured search target"))
        .await
        .expect("submit should succeed");

    let result = result_value(runtime.run_search(RunSearchParams {
        query: "target".to_string(),
        limit: 10,
    }));

    assert_eq!(result["query"], "target");
    assert_eq!(result["runs"][0]["prompt"], "structured search target");

    let empty = result_value(runtime.run_search(RunSearchParams {
        query: "   ".to_string(),
        limit: 0,
    }));
    assert_eq!(empty["query"], "");
    assert!(empty["runs"]
        .as_array()
        .expect("runs should be array")
        .is_empty());
}

#[tokio::test]
async fn command_execute_toggles_direct_chat() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let enabled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct on".to_string(),
            })
            .await
            .expect("direct command should succeed"),
    );
    assert_eq!(enabled["handled"], true);
    let status_direct = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct status".to_string(),
            })
            .await
            .expect("direct status should succeed"),
    );
    assert_eq!(status_direct["message"], "Direct chat is on.");
    let disabled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct off".to_string(),
            })
            .await
            .expect("direct off should succeed"),
    );
    assert_eq!(disabled["message"], "Direct chat is off.");
    let toggled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct".to_string(),
            })
            .await
            .expect("direct toggle should succeed"),
    );
    assert_eq!(toggled["message"], "Direct chat is on.");
    let usage = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct sideways".to_string(),
            })
            .await
            .expect("bad direct command should return usage"),
    );
    assert_eq!(usage["handled"], false);
    assert!(usage["message"]
        .as_str()
        .expect("direct usage message")
        .contains("Usage: /direct"));

    let status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/status".to_string(),
            })
            .await
            .expect("status command should succeed"),
    );
    assert!(status["message"]
        .as_str()
        .expect("message should be string")
        .contains("direct chat: on"));
}

#[tokio::test]
async fn command_execute_manages_durable_goal() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let empty = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal".to_string(),
            })
            .await
            .expect("goal command should succeed"),
    );
    assert!(empty["message"]
        .as_str()
        .expect("message should be string")
        .contains("No active goal"));

    let set = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal Complete Rust TUI parity".to_string(),
            })
            .await
            .expect("goal set should succeed"),
    );
    assert_eq!(set["handled"], true);
    assert!(set["message"]
        .as_str()
        .expect("message should be string")
        .contains("Complete Rust TUI parity"));

    let paused = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal pause".to_string(),
            })
            .await
            .expect("goal pause should succeed"),
    );
    assert!(paused["message"]
        .as_str()
        .expect("message should be string")
        .contains("paused"));

    let current = result_value(runtime.goal_get().expect("goal get should succeed"));
    assert_eq!(current["goal"]["status"], "paused");
    assert_eq!(current["goal"]["objective"], "Complete Rust TUI parity");

    let resumed = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal resume".to_string(),
            })
            .await
            .expect("goal resume should succeed"),
    );
    assert!(resumed["message"]
        .as_str()
        .expect("message should be string")
        .contains("resumed"));

    let cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal clear".to_string(),
            })
            .await
            .expect("goal clear should succeed"),
    );
    assert_eq!(cleared["message"], "Goal cleared.");
    let current = result_value(runtime.goal_get().expect("goal get should succeed"));
    assert_eq!(current["goal"], Value::Null);
}

#[tokio::test]
async fn command_execute_covers_local_automation_pet_mcp_and_workflow_flows() {
    async fn command(runtime: &mut AppRuntime, input: &str) -> Value {
        result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: input.to_string(),
                })
                .await
                .unwrap_or_else(|err| panic!("{input} should succeed: {err}")),
        )
    }

    let store_path = test_store_path("command-flows");
    let mut runtime = AppRuntime::new(RuntimeConfig::default().with_run_store_path(&store_path));

    assert!(command(&mut runtime, "/agents").await["message"]
        .as_str()
        .expect("agents list message")
        .contains("No agent sessions"));
    assert!(
        command(&mut runtime, "/agents create Cover command branches").await["message"]
            .as_str()
            .expect("agents create message")
            .contains("Created")
    );
    let sessions = result_value(
        runtime
            .agent_session_list()
            .expect("agent session list should work"),
    );
    let session_id = sessions["sessions"][0]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();
    assert!(
        command(&mut runtime, &format!("/agents pause {session_id}")).await["message"]
            .as_str()
            .expect("agents pause message")
            .contains("Paused")
    );
    assert!(
        command(&mut runtime, &format!("/agents resume {session_id}")).await["message"]
            .as_str()
            .expect("agents resume message")
            .contains("Resumed")
    );
    assert!(command(
        &mut runtime,
        &format!("/agents message {session_id} keep going")
    )
    .await["message"]
        .as_str()
        .expect("agents message output")
        .contains("Steering queued"));
    assert!(
        command(&mut runtime, &format!("/agents fork {session_id}")).await["message"]
            .as_str()
            .expect("agents fork message")
            .contains("Forked")
    );
    assert!(
        command(&mut runtime, &format!("/agents cancel {session_id}")).await["message"]
            .as_str()
            .expect("agents cancel message")
            .contains("Cancelled")
    );
    assert!(command(&mut runtime, "/agents unknown").await["message"]
        .as_str()
        .expect("agents usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/channel").await["message"]
        .as_str()
        .expect("channel list")
        .contains("No channels"));
    assert!(
        command(&mut runtime, &format!("/channel add ops {session_id}")).await["message"]
            .as_str()
            .expect("channel add message")
            .contains("Added ops")
    );
    let channels = result_value(runtime.channel_list().expect("channel list should work"));
    let channel_id = channels["channels"][0]["channelId"]
        .as_str()
        .expect("channel id")
        .to_string();
    assert!(command(
        &mut runtime,
        &format!("/channel push {channel_id} new event")
    )
    .await["message"]
        .as_str()
        .expect("channel push message")
        .contains("Pushed event"));
    assert!(
        command(&mut runtime, &format!("/channel delete {channel_id}")).await["message"]
            .as_str()
            .expect("channel delete message")
            .contains("Deleted")
    );
    assert!(command(&mut runtime, "/channel nope").await["message"]
        .as_str()
        .expect("channel usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/schedule").await["message"]
        .as_str()
        .expect("schedule list")
        .contains("No schedules"));
    assert!(
        command(&mut runtime, "/schedule add daily daily summarize updates").await["message"]
            .as_str()
            .expect("schedule add")
            .contains("Added daily")
    );
    let schedules = result_value(runtime.schedule_list().expect("schedule list should work"));
    let schedule_id = schedules["schedules"][0]["scheduleId"]
        .as_str()
        .expect("schedule id")
        .to_string();
    assert!(
        command(&mut runtime, &format!("/schedule disable {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule disable")
            .contains("Disabled")
    );
    assert!(
        command(&mut runtime, &format!("/schedule enable {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule enable")
            .contains("Enabled")
    );
    assert!(
        command(&mut runtime, &format!("/schedule delete {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule delete")
            .contains("Deleted")
    );
    assert!(command(&mut runtime, "/schedule nope").await["message"]
        .as_str()
        .expect("schedule usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/pet").await["message"]
        .as_str()
        .expect("pet status")
        .contains("Pulse"));
    assert!(command(&mut runtime, "/pet hide").await["message"]
        .as_str()
        .expect("pet hide")
        .contains("hidden"));
    assert!(command(&mut runtime, "/pet show").await["message"]
        .as_str()
        .expect("pet show")
        .contains("visible"));
    assert!(command(&mut runtime, "/pet name Sentinel").await["message"]
        .as_str()
        .expect("pet name")
        .contains("Sentinel"));
    assert!(
        command(&mut runtime, "/pet mood celebrate").await["message"]
            .as_str()
            .expect("pet mood")
            .contains("celebrate")
    );
    assert!(command(&mut runtime, "/pet sleep").await["message"]
        .as_str()
        .expect("pet usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/mcp list").await["message"]
        .as_str()
        .expect("mcp list")
        .contains("No MCP servers"));
    assert!(command(
        &mut runtime,
        "/mcp add files https://example.com/mcp tools=read,write enabled=false"
    )
    .await["message"]
        .as_str()
        .expect("mcp add")
        .contains("Configured"));
    assert!(
        command(&mut runtime, "/mcp tools files search,list").await["message"]
            .as_str()
            .expect("mcp tools")
            .contains("Updated tools")
    );
    assert!(command(&mut runtime, "/mcp disable files").await["message"]
        .as_str()
        .expect("mcp disable")
        .contains("Disabled"));
    assert!(command(&mut runtime, "/mcp enable files").await["message"]
        .as_str()
        .expect("mcp enable")
        .contains("Enabled"));
    assert!(command(&mut runtime, "/mcp available").await["message"]
        .as_str()
        .expect("mcp available")
        .contains("Enabled MCP servers"));
    assert!(command(&mut runtime, "/mcp inspect files").await["message"]
        .as_str()
        .expect("mcp inspect")
        .contains("transport"));
    assert!(command(&mut runtime, "/mcp remove files").await["message"]
        .as_str()
        .expect("mcp remove")
        .contains("Removed"));
    assert_eq!(command(&mut runtime, "/mcp nope").await["handled"], false);

    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "slash-workflow".to_string(),
                name: "Slash Workflow".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![WorkflowPhaseDefinition {
                    phase_id: "draft".to_string(),
                    name: "Draft".to_string(),
                    kind: WorkflowPhaseKind::Prompt,
                    prompt: Some("draft".to_string()),
                    depends_on: Vec::new(),
                    agent_count: Some(1),
                    output_schema: None,
                }],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");
    assert!(command(&mut runtime, "/workflows list").await["message"]
        .as_str()
        .expect("workflow list")
        .contains("Slash Workflow"));
    assert!(
        command(&mut runtime, "/workflows run slash-workflow").await["message"]
            .as_str()
            .expect("workflow run")
            .contains("Queued")
    );
    let workflow_runs = result_value(
        runtime
            .workflow_run_list()
            .expect("workflow run list should work"),
    );
    let workflow_run_id = workflow_runs["runs"][0]["runId"]
        .as_str()
        .expect("workflow run id")
        .to_string();
    assert!(command(&mut runtime, "/workflows runs").await["message"]
        .as_str()
        .expect("workflow runs")
        .contains(&workflow_run_id));
    assert!(
        command(&mut runtime, &format!("/workflows pause {workflow_run_id}")).await["message"]
            .as_str()
            .expect("workflow pause")
            .contains("Paused")
    );
    assert!(command(
        &mut runtime,
        &format!("/workflows resume {workflow_run_id}")
    )
    .await["message"]
        .as_str()
        .expect("workflow resume")
        .contains("Resumed"));
    assert!(command(
        &mut runtime,
        &format!("/workflows cancel {workflow_run_id}")
    )
    .await["message"]
        .as_str()
        .expect("workflow cancel")
        .contains("Cancelled"));
    assert!(command(&mut runtime, "/workflows nope").await["message"]
        .as_str()
        .expect("workflow usage")
        .contains("Usage"));

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn command_execute_covers_settings_project_mcp_validation_edges() {
    fn assert_usage(error: RuntimeError, expected: &str) {
        assert!(
            error.to_string().contains(expected),
            "expected {expected:?} in {error}"
        );
    }

    async fn command_error(runtime: &mut AppRuntime, input: &str) -> RuntimeError {
        runtime
            .command_execute(CommandExecuteParams {
                input: input.to_string(),
            })
            .await
            .expect_err(&format!("{input} should fail"))
    }

    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let logging = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/settings logging".to_string(),
            })
            .await
            .expect("logging status should render"),
    );
    assert!(logging["message"]
        .as_str()
        .expect("logging message")
        .contains("Logging level"));
    let logging_level = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/settings logging level warn".to_string(),
            })
            .await
            .expect("logging level should update"),
    );
    assert_eq!(logging_level["message"], "Logging settings updated.");
    let logging_format = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/settings logging format json".to_string(),
            })
            .await
            .expect("logging format should update"),
    );
    assert_eq!(logging_format["message"], "Logging settings updated.");
    let logging_usage = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/settings logging mystery".to_string(),
            })
            .await
            .expect("unknown logging action should return usage"),
    );
    assert_eq!(logging_usage["handled"], false);
    assert!(logging_usage["message"]
        .as_str()
        .expect("logging usage")
        .contains("Usage: /settings logging"));
    let account_unauth = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/settings account".to_string(),
            })
            .await
            .expect("unauthenticated settings account should return adapter guidance"),
    );
    assert_eq!(account_unauth["handled"], false);
    assert!(account_unauth["message"]
        .as_str()
        .expect("settings account guidance")
        .contains("requires the authenticated product settings adapter"));

    assert_usage(
        runtime
            .remote_settings_notifications("token", &[String::from("maybe")])
            .await
            .expect_err("bad notifications flag should fail"),
        "notifications <on|off>",
    );
    assert_usage(
        runtime
            .remote_settings_personalization("token", &[String::from("memory")])
            .await
            .expect_err("missing personalization flag should fail"),
        "personalization",
    );
    assert_usage(
        runtime
            .remote_settings_personalization(
                "token",
                &[String::from("unknown"), String::from("off")],
            )
            .await
            .expect_err("unknown personalization key should fail"),
        "personalization",
    );
    assert_usage(
        runtime
            .remote_settings_personalization(
                "token",
                &[String::from("memory"), String::from("maybe")],
            )
            .await
            .expect_err("bad personalization flag should fail"),
        "personalization",
    );
    assert_usage(
        runtime
            .remote_settings_subscription("token", &[String::from("upgrade")])
            .await
            .expect_err("missing plan should fail"),
        "subscription upgrade",
    );
    assert_usage(
        runtime
            .remote_settings_subscription(
                "token",
                &[String::from("upgrade"), String::from("enterprise")],
            )
            .await
            .expect_err("bad plan should fail"),
        "plan must be one of",
    );
    assert_usage(
        runtime
            .remote_settings_subscription("token", &[String::from("pause")])
            .await
            .expect_err("bad subscription action should fail"),
        "subscription <status|cancel",
    );
    assert_usage(
        runtime
            .remote_settings_data("token", &[String::from("delete")])
            .await
            .expect_err("missing delete email should fail"),
        "data delete",
    );
    assert_usage(
        runtime
            .remote_settings_data("token", &[String::from("wipe")])
            .await
            .expect_err("bad data action should fail"),
        "settings data",
    );
    assert_usage(
        runtime
            .remote_settings_apps("token", &[String::from("connect")])
            .await
            .expect_err("missing connect provider should fail"),
        "apps connect",
    );
    assert_usage(
        runtime
            .remote_settings_apps("token", &[String::from("disconnect")])
            .await
            .expect_err("missing disconnect provider should fail"),
        "apps disconnect",
    );
    assert_usage(
        runtime
            .remote_settings_apps("token", &[String::from("sync")])
            .await
            .expect_err("bad apps action should fail"),
        "settings apps",
    );

    let project_create_usage = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project create".to_string(),
            })
            .await
            .expect("empty project create should return usage"),
    );
    assert_eq!(project_create_usage["handled"], false);
    assert!(project_create_usage["message"]
        .as_str()
        .expect("project usage")
        .contains("Usage: /project create"));
    assert_eq!(
        result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: "/project nonsense".to_string(),
                })
                .await
                .expect("unknown project action should return usage"),
        )["handled"],
        false
    );

    assert_usage(
        command_error(&mut runtime, "/mcp add files").await,
        "mcp add",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp remove").await,
        "mcp remove",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp enable").await,
        "mcp enable",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp disable").await,
        "mcp disable",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp tools files").await,
        "mcp tools",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp inspect").await,
        "mcp inspect",
    );
    assert_usage(
        command_error(&mut runtime, "/mcp call files").await,
        "mcp call",
    );
}

#[tokio::test]
async fn command_execute_manages_orchestration_config() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let set = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate set researcher openai/gpt-5".to_string(),
            })
            .await
            .expect("orchestration set command should succeed"),
    );
    assert_eq!(set["handled"], true);
    assert!(set["message"]
        .as_str()
        .expect("message should be string")
        .contains("- Researcher: openai/gpt-5"));

    let budget = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate budget 35.5".to_string(),
            })
            .await
            .expect("orchestration budget command should succeed"),
    );
    assert_eq!(budget["handled"], true);
    assert!(budget["message"]
        .as_str()
        .expect("message should be string")
        .contains("Budget: $35.50"));
    let budget_status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate budget".to_string(),
            })
            .await
            .expect("orchestration budget status should succeed"),
    );
    assert!(budget_status["message"]
        .as_str()
        .expect("budget status message")
        .contains("$35.50"));
    let shorthand = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate analyst:local/llama".to_string(),
            })
            .await
            .expect("orchestration role shorthand should succeed"),
    );
    assert!(shorthand["message"]
        .as_str()
        .expect("shorthand message")
        .contains("- Analyst: local/llama"));
    let bad_action = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate nonsense".to_string(),
            })
            .await
            .expect("unknown orchestration action should return usage"),
    );
    assert_eq!(bad_action["handled"], false);
    assert!(bad_action["message"]
        .as_str()
        .expect("usage message")
        .contains("Usage: /orchestrate"));
    let missing_role = runtime
        .command_execute(CommandExecuteParams {
            input: "/orchestrate set".to_string(),
        })
        .await
        .expect_err("missing role should fail");
    assert_eq!(missing_role.code, -32602);
    let missing_model = runtime
        .command_execute(CommandExecuteParams {
            input: "/orchestrate set analyst".to_string(),
        })
        .await
        .expect_err("missing model should fail");
    assert_eq!(missing_model.code, -32602);

    let status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestration status".to_string(),
            })
            .await
            .expect("orchestration status command should succeed"),
    );
    assert!(status["message"]
        .as_str()
        .expect("message should be string")
        .contains("openai/gpt-5"));

    let config = result_value(
        runtime
            .orchestration_get()
            .expect("orchestration config should be readable"),
    );
    assert_eq!(config["orchestration"]["budget"], 35.5);
    assert_eq!(
        config["orchestration"]["roles"][0]["modelId"],
        "openai/gpt-5"
    );

    let cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/orchestrate clear".to_string(),
            })
            .await
            .expect("orchestration clear command should succeed"),
    );
    assert_eq!(cleared["message"], "Custom orchestration config cleared.");
    let config = result_value(
        runtime
            .orchestration_get()
            .expect("orchestration config should be readable"),
    );
    assert_eq!(config["orchestration"]["budget"], Value::Null);
    assert_eq!(config["orchestration"]["roles"][0]["modelId"], Value::Null);
}

#[tokio::test]
async fn command_execute_manages_pending_prompts() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let added = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending add retry from command".to_string(),
            })
            .await
            .expect("pending add command should succeed"),
    );
    assert_eq!(added["handled"], true);
    assert!(added["message"]
        .as_str()
        .expect("message should be string")
        .starts_with("Queued manual_"));

    let listed = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending".to_string(),
            })
            .await
            .expect("pending list command should succeed"),
    );
    assert!(listed["message"]
        .as_str()
        .expect("message should be string")
        .contains("retry from command"));

    let pending = result_value(runtime.pending_prompt_list());
    let pending_id = pending["prompts"][0]["id"]
        .as_str()
        .expect("pending prompt id should be string")
        .to_string();

    let deleted = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: format!("/pending delete {pending_id}"),
            })
            .await
            .expect("pending delete command should succeed"),
    );
    assert_eq!(deleted["message"], format!("Deleted {pending_id}."));
    assert_eq!(
        result_value(runtime.pending_prompt_list())["prompts"]
            .as_array()
            .expect("prompts should be array")
            .len(),
        0
    );
}

#[tokio::test]
async fn command_execute_manages_prompt_queue_and_pending_changes() {
    let store_path = test_store_path("queue-command");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let queued = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/prompt-queue add after_response conversation-1 follow up later"
                    .to_string(),
            })
            .await
            .expect("prompt queue add command should succeed"),
    );
    assert_eq!(queued["handled"], true);
    assert!(queued["message"]
        .as_str()
        .expect("message should be string")
        .contains("for after_response"));

    let listed = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/prompt-queue".to_string(),
            })
            .await
            .expect("prompt queue list command should succeed"),
    );
    let list_message = listed["message"]
        .as_str()
        .expect("message should be string");
    assert!(list_message.contains("follow up later"));
    assert!(list_message.contains("conversation=conversation-1"));

    let queue = result_value(
        runtime
            .prompt_queue_list()
            .expect("prompt queue should be readable"),
    );
    let queued_id = queue["queuedPrompts"][0]["id"]
        .as_i64()
        .expect("queued prompt id should be numeric");
    let deleted = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: format!("/prompt-queue delete {queued_id}"),
            })
            .await
            .expect("prompt queue delete command should succeed"),
    );
    assert_eq!(
        deleted["message"],
        format!("Deleted queued prompt {queued_id}.")
    );

    let pending_change = result_value(
        runtime
            .pending_change_add(PendingChangeRecord {
                id: None,
                change_type: "message".to_string(),
                entity_id: "message-1".to_string(),
                operation: "create".to_string(),
                data: json!({"messageId": "message-1"}),
                created_at: 1,
            })
            .expect("pending change should add"),
    );
    let pending_change_id = pending_change["pendingChange"]["id"]
        .as_i64()
        .expect("pending change id should be numeric");

    let changes = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending-changes".to_string(),
            })
            .await
            .expect("pending changes list command should succeed"),
    );
    assert!(changes["message"]
        .as_str()
        .expect("message should be string")
        .contains("message-1"));

    let removed = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: format!("/pending-changes delete {pending_change_id}"),
            })
            .await
            .expect("pending changes delete command should succeed"),
    );
    assert_eq!(
        removed["message"],
        format!("Deleted pending change {pending_change_id}.")
    );
    assert_eq!(
        result_value(
            runtime
                .pending_change_list()
                .expect("pending changes should be readable")
        )["pendingChanges"]
            .as_array()
            .expect("pending changes should be array")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn command_execute_covers_queue_usage_clear_and_attachment_commands() {
    let store_path = test_store_path("queue-command-edges");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let pending_usage = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending add".to_string(),
            })
            .await
            .expect("pending add usage should return a handled result"),
    );
    assert_eq!(pending_usage["handled"], false);
    assert!(pending_usage["message"]
        .as_str()
        .expect("message should be string")
        .contains("Usage: /pending add"));

    let pending_replay = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending replay".to_string(),
            })
            .await
            .expect("empty pending replay should succeed"),
    );
    assert!(pending_replay["message"]
        .as_str()
        .expect("message should be string")
        .contains("No queued pending prompts"));
    let pending_delete_err = runtime
        .command_execute(CommandExecuteParams {
            input: "/pending delete".to_string(),
        })
        .await
        .expect_err("missing pending id should be invalid");
    assert!(pending_delete_err.message.contains("/pending delete"));

    for input in [
        "/prompt-queue add later conversation-1 missing timing",
        "/prompt-queue add immediate",
    ] {
        let result = result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: input.to_string(),
                })
                .await
                .expect("prompt queue usage should return a result"),
        );
        assert_eq!(result["handled"], false);
        assert!(result["message"]
            .as_str()
            .expect("message should be string")
            .contains("Usage: /prompt-queue add"));
    }
    let prompt_delete_err = runtime
        .command_execute(CommandExecuteParams {
            input: "/prompt-queue delete nope".to_string(),
        })
        .await
        .expect_err("bad prompt queue id should be invalid");
    assert!(prompt_delete_err.message.contains("/prompt-queue delete"));
    let cleared_queue = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/prompt-queue clear".to_string(),
            })
            .await
            .expect("prompt queue clear should succeed"),
    );
    assert_eq!(cleared_queue["message"], "Cleared queued prompts.");

    let pending_change_delete_err = runtime
        .command_execute(CommandExecuteParams {
            input: "/pending-changes delete bad".to_string(),
        })
        .await
        .expect_err("bad pending change id should be invalid");
    assert!(pending_change_delete_err
        .message
        .contains("/pending-changes delete"));
    let cleared_changes = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/pending-changes clear".to_string(),
            })
            .await
            .expect("pending change clear should succeed"),
    );
    assert_eq!(cleared_changes["message"], "Cleared pending changes.");

    let attachments_empty = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/attachments".to_string(),
            })
            .await
            .expect("attachment list should succeed"),
    );
    assert!(attachments_empty["message"]
        .as_str()
        .expect("message should be string")
        .contains("No pending attachments"));
    let attachments_cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/attach clear".to_string(),
            })
            .await
            .expect("attachment clear should succeed"),
    );
    assert!(attachments_cleared["message"]
        .as_str()
        .expect("message should be string")
        .contains("Attachments cleared"));
    let attach_err = runtime
        .command_execute(CommandExecuteParams {
            input: "/attach missing.txt".to_string(),
        })
        .await
        .expect_err("attachment upload should require login before command result");
    assert_eq!(attach_err.message, "login required to upload attachments");

    let attachment_path = test_store_path("queue-command-attachment").with_extension("txt");
    std::fs::write(&attachment_path, "queued command attachment")
        .expect("attachment fixture should write");
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": "att-command-1",
                "mime_type": "text/plain",
                "size": 25
            })
            .to_string(),
        ),
    ]);
    let mut upload_runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    upload_runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    let uploaded = result_value(
        upload_runtime
            .command_execute(CommandExecuteParams {
                input: format!("/attach {}", attachment_path.display()),
            })
            .await
            .expect("attachment command should upload"),
    );
    assert!(uploaded["message"]
        .as_str()
        .expect("message should be string")
        .contains("Uploaded taskforceai-app-server-queue-command-attachment"));
    let attachments_list = result_value(
        upload_runtime
            .command_execute(CommandExecuteParams {
                input: "/attachments".to_string(),
            })
            .await
            .expect("attachment list should show pending upload"),
    );
    assert!(attachments_list["message"]
        .as_str()
        .expect("message should be string")
        .contains("1 / 5 attachments pending"));
    server.join().expect("mock attachment server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/attachments/upload");
    let _ = std::fs::remove_file(attachment_path);
    let _ = std::fs::remove_file(store_path);
}

#[test]
fn goal_protocol_methods_share_goal_state() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let set = result_value(
        runtime
            .goal_set(GoalSetParams {
                objective: "Ship goal support".to_string(),
            })
            .expect("goal set should succeed"),
    );
    assert_eq!(set["goal"]["status"], "active");

    let paused = result_value(runtime.goal_pause().expect("goal pause should succeed"));
    assert_eq!(paused["goal"]["status"], "paused");

    let resumed = result_value(runtime.goal_resume().expect("goal resume should succeed"));
    assert_eq!(resumed["goal"]["status"], "active");

    let raw = runtime
        .metadata_value("goal_state")
        .expect("goal should be persisted")
        .expect("goal metadata should exist");
    let goal: crate::protocol::GoalRecord =
        serde_json::from_str(&raw).expect("goal metadata should decode");
    assert_eq!(goal.objective, "Ship goal support");
    assert_eq!(goal.status, GoalStatus::Active);

    let cleared = result_value(runtime.goal_clear().expect("goal clear should succeed"));
    assert_eq!(cleared["ok"], true);
    let current = result_value(runtime.goal_get().expect("goal get should succeed"));
    assert_eq!(current["goal"], Value::Null);
}

#[tokio::test]
async fn command_execute_sets_default_model_for_submitted_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let model = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/model set zai/glm-5.2".to_string(),
            })
            .await
            .expect("model command should succeed"),
    );
    assert_eq!(model["handled"], true);

    let response = runtime
        .run_submit(submit_run_params("use default model"))
        .await
        .expect("submit should succeed");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["modelId"], "zai/glm-5.2");
}

#[tokio::test]
async fn model_methods_manage_shared_selector_state() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let list = result_value(runtime.model_list().await.expect("model list should work"));

    assert_eq!(list["enabled"], true);
    assert_eq!(list["remoteCatalog"], false);
    assert!(
        list["options"]
            .as_array()
            .expect("models should list")
            .len()
            >= 3
    );

    let selected = result_value(
        runtime
            .model_select(ModelSelectParams {
                model_id: "gpt-5".to_string(),
            })
            .await
            .expect("model select should work"),
    );
    assert_eq!(selected["selectedModelId"], "gpt-5");

    let reset = result_value(
        runtime
            .model_reset()
            .await
            .expect("model reset should work"),
    );
    assert_eq!(reset["selectedModelId"], serde_json::Value::Null);
}

#[tokio::test]
async fn project_use_sets_default_project_for_submitted_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let selected = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project use 42".to_string(),
            })
            .await
            .expect("project command should succeed"),
    );
    assert_eq!(selected["handled"], true);

    let response = runtime
        .run_submit(submit_run_params("use active project"))
        .await
        .expect("submit should succeed");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["projectId"], 42);

    let cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project clear".to_string(),
            })
            .await
            .expect("project clear should succeed"),
    );
    assert_eq!(cleared["handled"], true);
    assert_eq!(
        runtime
            .active_project_id()
            .expect("active project should parse"),
        None
    );
}

#[tokio::test]
async fn project_methods_cover_local_empty_auth_and_remote_api_flows() {
    let mut local_runtime = AppRuntime::new(RuntimeConfig::default());
    local_runtime
        .project_use(ProjectIDParams { project_id: 77 })
        .expect("project use should persist active id");
    let unauthenticated = result_value(
        local_runtime
            .project_list()
            .await
            .expect("unauthenticated project list should be empty"),
    );
    assert_eq!(unauthenticated["activeProjectId"], 77);
    assert_eq!(
        unauthenticated["projects"]
            .as_array()
            .expect("projects should be an array")
            .len(),
        0
    );
    let empty_name = local_runtime
        .project_create(ProjectCreateParams {
            name: "   ".to_string(),
            description: None,
            custom_instructions: None,
        })
        .await
        .expect_err("empty project name should fail");
    assert_eq!(empty_name.code, -32602);
    let invalid_id = local_runtime
        .project_use(ProjectIDParams { project_id: 0 })
        .expect_err("zero project id should fail");
    assert_eq!(invalid_id.code, -32602);
    let unauth_create = local_runtime
        .project_create(ProjectCreateParams {
            name: "No Auth".to_string(),
            description: None,
            custom_instructions: None,
        })
        .await
        .expect_err("project create should require auth");
    assert_eq!(unauth_create.code, -32010);
    let unauth_delete = local_runtime
        .project_delete(ProjectIDParams { project_id: 77 })
        .await
        .expect_err("project delete should require auth");
    assert_eq!(unauth_delete.code, -32010);

    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!([
                {
                    "id": 12,
                    "name": "Research",
                    "description": "Lab work",
                    "customInstructions": "Be precise",
                    "createdAt": "2026-01-02T03:04:05Z"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": 13,
                "name": "New Project",
                "description": "Drafts",
                "customInstructions": "Ship tests",
                "createdAt": "2026-02-03T04:05:06Z"
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response("{}".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime
        .project_use(ProjectIDParams { project_id: 12 })
        .expect("active project should persist");

    let listed = result_value(
        runtime
            .project_list()
            .await
            .expect("project list should work"),
    );
    assert_eq!(listed["activeProjectId"], 12);
    assert_eq!(listed["projects"][0]["name"], "Research");
    let created = result_value(
        runtime
            .project_create(ProjectCreateParams {
                name: "  New Project  ".to_string(),
                description: Some("Drafts".to_string()),
                custom_instructions: Some("Ship tests".to_string()),
            })
            .await
            .expect("project create should work"),
    );
    assert_eq!(created["project"]["id"], 13);
    assert_eq!(created["project"]["name"], "New Project");
    let deleted = result_value(
        runtime
            .project_delete(ProjectIDParams { project_id: 12 })
            .await
            .expect("project delete should work"),
    );
    assert_eq!(deleted["ok"], true);
    assert_eq!(
        runtime
            .active_project_id()
            .expect("active project should parse"),
        None
    );

    server.join().expect("mock project server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/projects");
    assert_eq!(requests[2].method, "POST");
    assert_eq!(requests[2].path, "/projects");
    let create_body: Value =
        serde_json::from_str(&requests[2].body).expect("create body should be json");
    assert_eq!(create_body["name"], "New Project");
    assert_eq!(requests[4].method, "DELETE");
    assert_eq!(requests[4].path, "/projects/12");
}

#[tokio::test]
async fn project_command_covers_status_create_delete_and_usage() {
    let mut local_runtime = AppRuntime::new(RuntimeConfig::default());
    let local_status = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project status".to_string(),
            })
            .await
            .expect("local project status should work"),
    );
    assert!(local_status["message"]
        .as_str()
        .expect("message should be string")
        .contains("No remote projects available"));
    let missing_create_name = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project create".to_string(),
            })
            .await
            .expect("missing project create name returns usage"),
    );
    assert_eq!(missing_create_name["handled"], false);
    let bad_use = local_runtime
        .command_execute(CommandExecuteParams {
            input: "/project use nope".to_string(),
        })
        .await
        .expect_err("bad project id should fail");
    assert!(bad_use.message.contains("project id must be an integer"));
    let unknown = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project wat".to_string(),
            })
            .await
            .expect("unknown project command should return usage"),
    );
    assert_eq!(unknown["handled"], false);

    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!([
                {
                    "id": 21,
                    "name": "Ops",
                    "description": null,
                    "customInstructions": null,
                    "createdAt": "2026-03-04T05:06:07Z"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": 22,
                "name": "New Ops",
                "description": null,
                "customInstructions": null,
                "createdAt": "2026-03-05T06:07:08Z"
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response("{}".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime
        .project_use(ProjectIDParams { project_id: 21 })
        .expect("active project should persist");

    let remote_status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/projects ls".to_string(),
            })
            .await
            .expect("remote project list command should work"),
    );
    assert!(remote_status["message"]
        .as_str()
        .expect("message should be string")
        .contains("* 21: Ops"));
    let created = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project create New Ops".to_string(),
            })
            .await
            .expect("project create command should work"),
    );
    assert_eq!(created["message"], "Created project 22: New Ops");
    let deleted = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project delete 22".to_string(),
            })
            .await
            .expect("project delete command should work"),
    );
    assert_eq!(deleted["message"], "Deleted project 22.");

    server
        .join()
        .expect("mock project command server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].path, "/projects");
    assert_eq!(requests[2].path, "/projects");
    assert_eq!(requests[4].path, "/projects/22");
}

#[tokio::test]
async fn auth_status_tracks_cached_token_and_logout_clears_it() {
    use base64::Engine as _;

    fn token_with_claims(claims: Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"alg":"none"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
        format!("{header}.{payload}.sig")
    }

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: token_with_claims(json!({
                "id": 42,
                "email": "ops@example.com",
                "full_name": "Ops User",
                "picture": "https://example.com/avatar.png"
            })),
        })
        .expect("auth token should persist");

    let authenticated = result_value(runtime.auth_status());
    assert_eq!(authenticated["authenticated"], true);
    assert_eq!(authenticated["user"]["id"], "42");
    assert_eq!(authenticated["user"]["email"], "ops@example.com");
    assert_eq!(authenticated["user"]["fullName"], "Ops User");
    assert_eq!(
        authenticated["user"]["image"],
        "https://example.com/avatar.png"
    );
    assert!(authenticated.get("token").is_none());

    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: token_with_claims(json!({
                "id": "user-42",
                "email": "named@example.com",
                "name": "Named User",
                "image": "https://example.com/named.png"
            })),
        })
        .expect("string-claim auth token should persist");
    let named = result_value(runtime.auth_status());
    assert_eq!(named["user"]["id"], "user-42");
    assert_eq!(named["user"]["fullName"], "Named User");
    assert_eq!(named["user"]["image"], "https://example.com/named.png");

    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: token_with_claims(json!({})),
        })
        .expect("empty-claims auth token should persist");
    let empty_claims = result_value(runtime.auth_status());
    assert_eq!(empty_claims["authenticated"], true);
    assert_eq!(empty_claims["user"], Value::Null);

    let logout = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/logout".to_string(),
            })
            .await
            .expect("logout command should succeed"),
    );
    assert_eq!(logout["handled"], true);
    let unauthenticated = result_value(runtime.auth_status());
    assert_eq!(unauthenticated["authenticated"], false);
    assert!(unauthenticated.get("token").is_none());
}

#[tokio::test]
async fn api_health_reports_remote_status_and_base_url() {
    let (base_url, server, requests) =
        start_recording_response_sequence_server(vec![json_response("{}".to_string())]);
    let runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url.clone(),
        ..RuntimeConfig::default()
    });

    let health = result_value(
        runtime
            .api_health()
            .await
            .expect("api health should succeed"),
    );

    assert_eq!(health["healthy"], true);
    assert_eq!(health["status"], 200);
    assert_eq!(health["baseUrl"], base_url);
    server.join().expect("mock health server should exit");
    assert_eq!(
        requests.lock().expect("requests should be recorded")[0].path,
        "/health"
    );
}

#[tokio::test]
async fn device_login_poll_stores_approved_access_token() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "device_code": "device-123",
                "user_code": "ABCD",
                "verification_uri": "https://example.com/device",
                "verification_uri_complete": "https://example.com/device?user_code=ABCD",
                "expires_in": 600,
                "interval": 5
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "status": "approved",
                "accessToken": "approved-token",
                "expires_in": 3600
            })
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });

    let started = result_value(
        runtime
            .auth_device_start()
            .await
            .expect("device login should start"),
    );
    assert_eq!(started["deviceCode"], "device-123");
    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("device login should poll"),
    );
    assert_eq!(polled["status"], "approved");
    assert_eq!(polled["token"], "approved-token");
    assert_eq!(result_value(runtime.auth_status())["authenticated"], true);
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "approved-token"
    );
    server.join().expect("mock auth server should exit");

    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/auth/device/start");
    assert_eq!(requests[3].path, "/auth/device/token");
    let body: Value = serde_json::from_str(&requests[3].body).expect("poll body should be json");
    assert_eq!(body["device_code"], "device-123");
}

#[tokio::test]
async fn device_login_approved_without_token_keeps_existing_auth() {
    let (base_url, server, _requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "status": "approved", "expires_in": 60 }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "existing-token".to_string(),
        })
        .expect("auth token should persist");

    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("approved poll without token should not replace auth"),
    );

    assert_eq!(polled["status"], "approved");
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "existing-token"
    );
    server.join().expect("mock auth server should exit");
}

#[tokio::test]
async fn device_login_pending_does_not_replace_existing_token() {
    let (base_url, server, _requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "status": "pending", "interval": 5 }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "existing-token".to_string(),
        })
        .expect("auth token should persist");

    let polled = result_value(
        runtime
            .auth_device_poll(DeviceLoginPollParams {
                device_code: "device-123".to_string(),
            })
            .await
            .expect("pending device login should poll"),
    );

    assert_eq!(polled["status"], "pending");
    assert_eq!(
        result_value(
            runtime
                .metadata_get(MetadataGetParams {
                    key: "auth_token".to_string(),
                })
                .expect("auth token should be readable")
        )["value"],
        "existing-token"
    );
    server.join().expect("mock auth server should exit");
}

#[test]
fn auth_token_is_not_persisted_to_plaintext_metadata_store() {
    let store_path = test_store_path("auth-token-restart");
    let config = RuntimeConfig {
        auth_token_storage: AuthTokenStorage::KeyringWithMetadataFallback,
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime.set_auth_token(Some("persisted-token")).unwrap();
    assert_eq!(
        runtime
            .auth_token()
            .expect("auth token should read")
            .as_deref(),
        Some("persisted-token")
    );
    assert_ne!(
        runtime
            .metadata_value("auth_token")
            .expect("metadata should read")
            .as_deref(),
        Some("persisted-token")
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn delete_removes_run_from_history() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("delete me"))
        .await
        .expect("submit should succeed");

    let response = runtime
        .run_delete(RunIDParams {
            run_id: "local_run_1".to_string(),
        })
        .expect("delete should succeed");
    let AppResponse::WithEvents { result, events } = response else {
        panic!("expected response with events");
    };

    assert_eq!(result["ok"], true);
    assert_eq!(events.len(), 1);
    let AppResponse::Value(history) = runtime.history_list(HistoryListParams { limit: 10 }) else {
        panic!("expected history response");
    };
    assert_eq!(
        history["runs"]
            .as_array()
            .expect("runs should be array")
            .len(),
        0
    );
}

#[tokio::test]
async fn apply_event_preserves_canceled_runs_and_deletes_existing_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("apply event"))
        .await
        .expect("submit should succeed");
    runtime
        .run_cancel(RunIDParams {
            run_id: "local_run_1".to_string(),
        })
        .expect("cancel should succeed");

    let mut stale = runtime
        .get_run("local_run_1")
        .expect("run should exist after cancel");
    stale.status = RunStatus::Processing;
    stale.output = Some("late output".to_string());
    let events = runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(stale),
        })
        .expect("late event should be handled");
    assert_eq!(events.len(), 1);
    match &events[0] {
        AppServerEvent::RunUpdated { run } => assert_eq!(run.status, RunStatus::Canceled),
        other => panic!("unexpected event: {other:?}"),
    }
    assert_eq!(
        runtime
            .get_run("local_run_1")
            .expect("run should remain")
            .status,
        RunStatus::Canceled
    );

    runtime
        .apply_event(AppServerEvent::RunDeleted {
            run_id: "local_run_1".to_string(),
        })
        .expect("delete event should be handled");
    assert!(runtime.get_run("local_run_1").is_err());

    let unknown = AppServerEvent::RunUpdated {
        run: Box::new(RunRecord {
            id: "missing_run".to_string(),
            prompt: "missing".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: Some("ignored".to_string()),
            error: None,
            created_at: 1,
            updated_at: 2,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }),
    };
    let events = runtime
        .apply_event(unknown)
        .expect("unknown run update should be retained as event");
    assert_eq!(events.len(), 1);
}

#[tokio::test]
async fn usage_summary_counts_run_statuses() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("completed"))
        .await
        .expect("submit should succeed");
    let canceled = runtime
        .run_submit(submit_run_params("cancel me"))
        .await
        .expect("submit should succeed");
    let AppResponse::WithEvents { result, .. } = canceled else {
        panic!("expected submitted run");
    };
    runtime
        .run_cancel(RunIDParams {
            run_id: result["run"]["id"].as_str().expect("run id").to_string(),
        })
        .expect("cancel should succeed");
    runtime.runs.insert(
        "failed_run".to_string(),
        RunRecord {
            id: "failed_run".to_string(),
            prompt: "failed".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Failed,
            output: None,
            error: Some("boom".to_string()),
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );
    runtime.runs.insert(
        "processing_run".to_string(),
        RunRecord {
            id: "processing_run".to_string(),
            prompt: "processing".to_string(),
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

    let usage = result_value(runtime.usage_summary());
    assert_eq!(usage["totalRuns"], 4);
    assert_eq!(usage["queuedRuns"], 1);
    assert_eq!(usage["canceledRuns"], 1);
    assert_eq!(usage["failedRuns"], 1);
    assert_eq!(usage["processingRuns"], 1);
}

#[tokio::test]
async fn account_command_requires_login() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/account".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Account");
    assert_eq!(result["handled"], false);
    assert!(result["message"]
        .as_str()
        .expect("message should be string")
        .contains("Login required"));
}

#[tokio::test]
async fn account_command_formats_authenticated_usage() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "plan": "pro",
                "message_count": 7,
                "current_period_end": "2026-06-30T00:00:00Z"
            })
            .to_string(),
        ),
        json_response(
            json!({
                "credit_balance": 12.5,
                "current_period_end": 1782777600
            })
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/account".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Account");
    assert_eq!(result["handled"], true);
    let message = result["message"]
        .as_str()
        .expect("message should be string");
    assert!(message.contains("plan: pro"));
    assert!(message.contains("messages: 7 used · 2 per hour"));
    assert!(message.contains("credits: $12.50"));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/auth/me");
    assert_eq!(recorded[1].path, "/billing/balance");
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_requires_login() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifacts");
    assert_eq!(result["handled"], false);
    assert!(result["message"]
        .as_str()
        .expect("message should be string")
        .contains("Login required"));

    for input in [
        "/artifacts show artifact-1",
        "/artifacts share artifact-1",
        "/artifacts delete artifact-1",
        "/artifacts download artifact-1",
    ] {
        let result = result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: input.to_string(),
                })
                .await
                .expect("command should return login guidance"),
        );
        assert_eq!(result["title"], "Artifacts");
        assert_eq!(result["handled"], false);
        assert!(result["message"]
            .as_str()
            .expect("message should be string")
            .contains("Login required"));
    }
}

#[tokio::test]
async fn artifacts_command_rejects_unknown_action_and_missing_ids() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let unknown = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts wat".to_string(),
            })
            .await
            .expect("unknown artifacts command should return usage"),
    );
    assert_eq!(unknown["title"], "Artifacts");
    assert_eq!(unknown["handled"], false);
    assert!(unknown["message"]
        .as_str()
        .expect("message should be string")
        .contains("Usage: /artifacts"));

    for input in [
        "/artifacts show",
        "/artifacts share",
        "/artifacts delete",
        "/artifacts download",
    ] {
        let error = runtime
            .command_execute(CommandExecuteParams {
                input: input.to_string(),
            })
            .await
            .expect_err("missing artifact id should be invalid");
        assert!(error.to_string().contains("artifact id is required"));
    }
}

#[tokio::test]
async fn artifacts_command_lists_authenticated_recent_artifacts() {
    let (base_url, server, requests) =
        start_recording_response_sequence_server(vec![json_response(
            json!([
                {
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PRIVATE",
                    "updatedAt": "2026-06-14T20:00:00Z",
                    "currentVersion": {
                        "id": "version-1",
                        "filename": "launch-memo.pdf",
                        "mimeType": "application/pdf",
                        "sizeBytes": 2048
                    }
                },
                {
                    "id": "artifact-2",
                    "title": "Revenue chart",
                    "type": "CHART",
                    "status": "READY",
                    "visibility": "PUBLIC_LINK"
                }
            ])
            .to_string(),
        )]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts list".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifacts");
    assert_eq!(result["handled"], true);
    let message = result["message"]
        .as_str()
        .expect("message should be string");
    assert!(message.contains("Recent artifacts: 2 shown"));
    assert!(message.contains("launch-memo.pdf [DOCUMENT · READY · PRIVATE]"));
    assert!(message.contains("application/pdf, 2.0 KB, version version-1"));
    assert!(message.contains("/artifacts/artifact-1"));
    assert!(message.contains("Revenue chart [CHART · READY · PUBLIC_LINK]"));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].method, "GET");
    assert_eq!(
        recorded[0].path,
        "/artifacts?limit=10&offset=0&include=currentVersion"
    );
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_shows_detail_and_versions() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersionId": "version-2",
                "createdAt": "2026-06-13T20:00:00Z",
                "updatedAt": "2026-06-14T20:00:00Z"
            })
            .to_string(),
        ),
        json_response(
            json!([
                {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "version": 2,
                    "fileId": "file-2",
                    "filename": "launch-memo.pdf",
                    "mimeType": "application/pdf",
                    "bytes": 2048,
                    "createdAt": "2026-06-14T20:00:00Z"
                }
            ])
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts show artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact");
    assert_eq!(result["handled"], true);
    let message = result["message"].as_str().expect("message");
    assert!(message.contains("title: Launch memo"));
    assert!(message.contains("path: /artifacts/artifact-1"));
    assert!(message.contains(
        "- v2 launch-memo.pdf [application/pdf] artifact=artifact-1 file=file-2 size=2048"
    ));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/versions");
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_creates_public_link() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "token": "public-token",
                "url": "https://taskforceai.chat/artifacts/public/public-token",
                "artifact": {
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PUBLIC_LINK"
                }
            })
            .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts share artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Link");
    assert_eq!(result["handled"], true);
    assert!(result["message"]
        .as_str()
        .expect("message")
        .contains("https://taskforceai.chat/artifacts/public/public-token"));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/api/auth/csrf");
    assert_eq!(recorded[1].method, "POST");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/share/public");
    assert_eq!(
        recorded[1].headers.get("x-csrf-token").map(String::as_str),
        Some("test-csrf")
    );
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_deletes_artifact() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "success": true }).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts delete artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Deleted");
    assert_eq!(result["handled"], true);
    assert_eq!(result["message"], "Deleted artifact artifact-1.");

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[1].method, "DELETE");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1");
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_downloads_current_file_without_overwriting() {
    let output_path = test_store_path("artifact-download").with_extension("txt");
    let _ = fs::remove_file(&output_path);
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersion": {
                    "id": "version-1",
                    "artifactId": "artifact-1",
                    "version": 1,
                    "fileId": "file-1",
                    "filename": "launch-memo.txt",
                    "mimeType": "text/plain",
                    "bytes": 11
                }
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: "hello bytes".to_string(),
            headers: Vec::new(),
        },
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: format!("/artifacts download artifact-1 {}", output_path.display()),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Downloaded");
    assert_eq!(result["handled"], true);
    assert_eq!(
        fs::read_to_string(&output_path).expect("artifact should write"),
        "hello bytes"
    );

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(
        recorded[1].path,
        "/developer/files/file-1/content?disposition=attachment"
    );
    drop(recorded);
    server.join().expect("mock server should finish");
    let _ = fs::remove_file(output_path);
}

#[tokio::test]
async fn artifacts_command_downloads_selected_version_when_current_is_missing() {
    let output_path = test_store_path("artifact-download-fallback").with_extension("txt");
    let _ = fs::remove_file(&output_path);
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersionId": "version-2"
            })
            .to_string(),
        ),
        json_response(
            json!([
                {
                    "id": "version-1",
                    "artifactId": "artifact-1",
                    "version": 1,
                    "fileId": "file-1",
                    "filename": "old.txt"
                },
                {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "version": 2,
                    "fileId": "file-2",
                    "filename": "selected.txt"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: "selected bytes".to_string(),
            headers: Vec::new(),
        },
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: format!("/artifacts download artifact-1 {}", output_path.display()),
            })
            .await
            .expect("fallback version download should succeed"),
    );

    assert_eq!(result["title"], "Artifact Downloaded");
    assert_eq!(
        fs::read_to_string(&output_path).expect("artifact should write"),
        "selected bytes"
    );
    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/versions");
    assert_eq!(
        recorded[2].path,
        "/developer/files/file-2/content?disposition=attachment"
    );
    drop(recorded);
    server.join().expect("mock server should finish");
    let _ = fs::remove_file(output_path);
}

#[tokio::test]
async fn artifacts_command_reports_missing_downloadable_versions() {
    for (responses, expected) in [
        (
            vec![json_response(
                json!({
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PRIVATE",
                    "currentVersion": {
                        "id": "version-1",
                        "artifactId": "artifact-1",
                        "version": 1,
                        "filename": "launch-memo.txt"
                    }
                })
                .to_string(),
            )],
            "no downloadable file version",
        ),
        (
            vec![
                json_response(
                    json!({
                        "id": "artifact-1",
                        "title": "Launch memo",
                        "type": "DOCUMENT",
                        "status": "READY",
                        "visibility": "PRIVATE"
                    })
                    .to_string(),
                ),
                json_response(json!([]).to_string()),
            ],
            "no versions available",
        ),
    ] {
        let (base_url, server, _requests) = start_recording_response_sequence_server(responses);
        let mut runtime = AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        runtime
            .metadata_set(MetadataSetParams {
                key: "auth_token".to_string(),
                value: "token".to_string(),
            })
            .expect("auth token should persist");

        let response = runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts download artifact-1".to_string(),
            })
            .await;
        match response {
            Ok(response) => {
                let result = result_value(response);
                assert!(result["message"]
                    .as_str()
                    .expect("message should be string")
                    .contains(expected));
            }
            Err(error) => assert!(error.to_string().contains(expected)),
        }
        server.join().expect("mock server should finish");
    }
}
