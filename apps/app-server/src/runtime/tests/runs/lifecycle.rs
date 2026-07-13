use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

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
async fn new_remote_approval_is_forwarded_through_the_interaction_broker() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({"ok": true}).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    let (output, mut messages) = tokio::sync::mpsc::channel(8);
    let broker = crate::interactions::InteractionBroker::new(output);
    runtime.set_interaction_broker(broker.clone());
    runtime
        .save_agent_sessions(&[crate::protocol::AgentSessionRecord {
            session_id: "approval-thread".to_string(),
            title: "Approval".to_string(),
            objective: "Approve remote run".to_string(),
            state: "running".to_string(),
            source: "test".to_string(),
            task_mode: crate::protocol::TaskMode::Work,
            parent_session_id: None,
            last_message: None,
            run_ids: vec!["remote-approval-run".to_string()],
            active_run_id: None,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        }])
        .expect("save approval session");
    let current = RunRecord {
        id: "remote-approval-run".to_string(),
        prompt: "approval".to_string(),
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
    };
    runtime.runs.insert(current.id.clone(), current.clone());
    let mut updated = current;
    updated.updated_at = 2;
    updated.pending_approval = Some(json!({
        "approvalId": "approval-1",
        "permission": "filesystem.write",
        "path": "README.md"
    }));
    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(updated),
        })
        .expect("apply approval event");

    let crate::protocol::OutgoingMessage::Request(request) =
        messages.recv().await.expect("approval request")
    else {
        panic!("expected approval request");
    };
    assert_eq!(request.method, "item/permissions/requestApproval");
    assert_eq!(request.params["threadId"], "approval-thread");
    assert_eq!(request.params["itemId"], "approval-1");
    assert_eq!(request.params["reason"], "Allow filesystem.write");
    assert!(
        broker
            .resolve(crate::protocol::JsonRpcResponse {
                jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
                id: Some(request.id),
                result: Some(json!({"decision": "accept", "result": {"remember": true}})),
                error: None,
            })
            .await
    );
    let _ = messages.recv().await.expect("resolved notification");
    tokio::task::spawn_blocking(move || server.join().expect("mock approval server should exit"))
        .await
        .expect("join mock server");
    let requests = requests.lock().expect("requests should be recorded");
    assert!(requests
        .iter()
        .any(|request| request.path == "/tasks/remote-approval-run/approve"));

    let events = runtime
        .apply_event(AppServerEvent::ServerRequest {
            request: crate::protocol::JsonRpcServerRequest {
                jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
                id: json!(99),
                method: "fixture/request".to_string(),
                params: json!({}),
            },
        })
        .expect("server request event");
    assert_eq!(events.len(), 1);
}

#[tokio::test]
async fn approval_interaction_decline_malformed_and_missing_broker_paths_are_safe() {
    for (index, result) in [
        json!({"decision": "decline", "result": {"reason": "no"}}),
        json!({"unexpected": true}),
    ]
    .into_iter()
    .enumerate()
    {
        let (base_url, server, requests) = start_recording_response_sequence_server(vec![
            MockHttpResponse {
                body: json!({ "csrfToken": "test-csrf" }).to_string(),
                headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
            },
            json_response(json!({"ok": true}).to_string()),
        ]);
        let mut runtime = AppRuntime::new(RuntimeConfig {
            api_base_url: base_url,
            ..RuntimeConfig::default()
        });
        set_auth_token(&mut runtime, "token");
        let (output, mut messages) = tokio::sync::mpsc::channel(8);
        let broker = crate::interactions::InteractionBroker::new(output);
        runtime.set_interaction_broker(broker.clone());
        let id = format!("approval-branch-{index}");
        let current = RunRecord {
            id: id.clone(),
            prompt: "approval branch".to_string(),
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
        };
        runtime.runs.insert(id.clone(), current.clone());
        let mut updated = current;
        updated.pending_approval = Some(json!({"id": "approval"}));
        runtime
            .apply_event(AppServerEvent::RunUpdated {
                run: Box::new(updated),
            })
            .expect("apply approval branch");
        let crate::protocol::OutgoingMessage::Request(request) =
            messages.recv().await.expect("approval request")
        else {
            panic!("expected approval request");
        };
        assert!(
            broker
                .resolve(crate::protocol::JsonRpcResponse {
                    jsonrpc: crate::protocol::JSONRPC_VERSION.to_string(),
                    id: Some(request.id),
                    result: Some(result),
                    error: None,
                })
                .await
        );
        let _ = messages.recv().await.expect("resolved notification");
        tokio::task::spawn_blocking(move || server.join().expect("approval server should exit"))
            .await
            .expect("join approval server");
        assert!(requests
            .lock()
            .expect("requests")
            .iter()
            .any(|request| request.path == format!("/tasks/{id}/approve")));
    }

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let current = RunRecord {
        id: "no-broker-approval".to_string(),
        prompt: "no broker".to_string(),
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
    };
    runtime.runs.insert(current.id.clone(), current.clone());
    let mut updated = current;
    updated.pending_approval = Some(json!({"id": "approval"}));
    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(updated),
        })
        .expect("missing broker is a no-op");
}

#[tokio::test]
async fn turn_steer_forwards_remote_runs_and_records_the_steering_item() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({"ok": true}).to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .save_agent_sessions(&[crate::protocol::AgentSessionRecord {
            session_id: "thread-steer".to_string(),
            title: "Steer".to_string(),
            objective: "Steer remote run".to_string(),
            state: "running".to_string(),
            source: "test".to_string(),
            task_mode: crate::protocol::TaskMode::Work,
            parent_session_id: None,
            last_message: None,
            run_ids: vec!["remote-run".to_string()],
            active_run_id: Some("remote-run".to_string()),
            last_error: None,
            created_at: 1,
            updated_at: 1,
        }])
        .expect("save steer session");
    runtime
        .save_thread_records(&[crate::protocol::ThreadRecord {
            id: "thread-steer".to_string(),
            title: "Steer".to_string(),
            objective: "Steer remote run".to_string(),
            state: crate::protocol::ThreadState::Active,
            archived: false,
            source: "test".to_string(),
            task_mode: crate::protocol::TaskMode::Work,
            parent_thread_id: None,
            turns: vec![crate::protocol::TurnRecord {
                id: "turn-steer".to_string(),
                thread_id: "thread-steer".to_string(),
                run_id: "remote-run".to_string(),
                status: crate::protocol::TurnStatus::InProgress,
                items: Vec::new(),
                created_at: 1,
                updated_at: 1,
            }],
            created_at: 1,
            updated_at: 1,
        }])
        .expect("save steer thread");

    let response = runtime
        .turn_steer(crate::protocol::TurnSteerParams {
            thread_id: "thread-steer".to_string(),
            input: " Focus on tests ".to_string(),
        })
        .await
        .expect("steer remote run");
    assert!(matches!(response, AppResponse::Value(_)));
    tokio::task::spawn_blocking(move || server.join().expect("mock steer server should exit"))
        .await
        .expect("join mock server");
    let requests = requests.lock().expect("requests should be recorded");
    assert!(requests
        .iter()
        .any(|request| request.path == "/tasks/remote-run/steer"));
}

#[tokio::test]
async fn private_chat_run_stays_out_of_history_and_search() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let response = runtime
        .run_submit(SubmitRunParams {
            private_chat: true,
            ..submit_run_params("private history target")
        })
        .await
        .expect("private submit should succeed");
    let result = result_value(response);
    let run_id = result["run"]["id"].as_str().expect("run id").to_string();

    let status = result_value(
        runtime
            .run_status(RunIDParams {
                run_id: run_id.clone(),
            })
            .expect("private run should remain available by id"),
    );
    assert_eq!(status["run"]["id"], run_id);

    let history = result_value(runtime.history_list(HistoryListParams { limit: 10 }));
    assert!(history["runs"].as_array().expect("runs array").is_empty());

    let search = result_value(runtime.run_search(RunSearchParams {
        query: "private history target".to_string(),
        limit: 10,
    }));
    assert!(search["runs"].as_array().expect("runs array").is_empty());

    let command_search = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/search target".to_string(),
            })
            .await
            .expect("command search should succeed"),
    );
    let command_search_message = command_search["message"]
        .as_str()
        .expect("command search message should be string");
    assert!(!command_search_message.contains("private history target"));
    assert!(!command_search_message.contains(&run_id));
}

#[tokio::test]
async fn private_chat_run_is_not_persisted() {
    let store_path = test_store_path("private-chat-run-not-persisted");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
    let response = runtime
        .run_submit(SubmitRunParams {
            private_chat: true,
            ..submit_run_params("do not persist me")
        })
        .await
        .expect("private submit should succeed");
    let result = result_value(response);
    let run_id = result["run"]["id"].as_str().expect("run id").to_string();

    assert!(runtime
        .run_status(RunIDParams {
            run_id: run_id.clone(),
        })
        .is_ok());

    let restarted = AppRuntime::try_new(config).expect("runtime should restart");
    let AppResponse::Value(history) = restarted.history_list(HistoryListParams { limit: 10 })
    else {
        panic!("expected history response");
    };
    assert!(history["runs"].as_array().expect("runs array").is_empty());
    assert!(restarted.run_status(RunIDParams { run_id }).is_err());
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
    set_auth_token(&mut runtime, "token");
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
    set_auth_token(&mut runtime, "token");

    let response = runtime
        .run_submit(SubmitRunParams {
            model_id: Some("openai/gpt-5.6-sol".to_string()),
            reasoning_effort: Some("max".to_string()),
            ..submit_run_params("queue on remote failure")
        })
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
    assert_eq!(pending["prompts"][0]["reasoningEffort"], "max");

    server.join().expect("mock submit server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/run");
    let body: Value = serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["reasoningEffort"], "max");
}

#[tokio::test]
async fn remote_submit_unauthorized_clears_auth_and_does_not_queue_pending_prompt() {
    let (base_url, server) = start_submit_unauthorized_server();
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "stale-token");

    let response = runtime
        .run_submit(submit_run_params("do not replay against stale auth"))
        .await
        .expect("unauthorized submit should return a failed run");
    let AppResponse::WithEvents { result, events } = response else {
        panic!("expected failed submit with events");
    };

    assert_eq!(result["run"]["status"], "failed");
    assert_eq!(
        result["run"]["error"],
        "login required. Please sign in again."
    );
    assert_eq!(events.len(), 1);
    assert_eq!(result_value(runtime.auth_status())["authenticated"], false);
    assert!(result_value(runtime.pending_prompt_list())["prompts"]
        .as_array()
        .expect("prompts array")
        .is_empty());

    server.join().expect("mock submit server should exit");
}

#[tokio::test]
async fn private_remote_submit_api_error_returns_failed_run_without_queueing_prompt() {
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
    set_auth_token(&mut runtime, "token");

    let response = runtime
        .run_submit(SubmitRunParams {
            private_chat: true,
            ..submit_run_params("private remote failure")
        })
        .await
        .expect("private submit failures are returned as failed runs");
    let result = result_value(response);

    assert_eq!(result["run"]["status"], "failed");
    assert!(result["run"]["error"]
        .as_str()
        .expect("error should be present")
        .contains("api error"));
    let pending = result_value(runtime.pending_prompt_list());
    assert!(pending["prompts"]
        .as_array()
        .expect("prompts array")
        .is_empty());

    server.join().expect("mock submit server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/run");
}

fn start_submit_unauthorized_server() -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("mock submit server should bind");
    let address = listener
        .local_addr()
        .expect("mock submit server address should be readable");
    let handle = thread::spawn(move || {
        write_response(
            &listener,
            "HTTP/1.1 200 OK",
            r#"{"csrfToken":"test-csrf"}"#,
            &[("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        );
        write_response(&listener, "HTTP/1.1 401 Unauthorized", "unauthorized", &[]);
    });
    (format!("http://{address}"), handle)
}

fn write_response(listener: &TcpListener, status: &str, body: &str, headers: &[(&str, &str)]) {
    let (mut stream, _) = listener.accept().expect("mock request should arrive");
    let mut buffer = [0_u8; 1024];
    let _ = stream.read(&mut buffer);
    let mut response = format!(
        "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    response.push_str(body);
    stream
        .write_all(response.as_bytes())
        .expect("mock response should write");
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
