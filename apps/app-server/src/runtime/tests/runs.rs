use super::support::{
    json_response, result_value, start_recording_response_sequence_server, submit_run_params,
    test_store_path, MockHttpResponse,
};
use super::*;
use crate::protocol::{ComputerUseTarget, RunModeSetParams};

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
                input: "/model set moonshotai/kimi-k2.6".to_string(),
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
    assert_eq!(result["run"]["modelId"], "moonshotai/kimi-k2.6");
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
async fn auth_status_tracks_cached_token_and_logout_clears_it() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let authenticated = result_value(runtime.auth_status());
    assert_eq!(authenticated["authenticated"], true);

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

    let usage = result_value(runtime.usage_summary());
    assert_eq!(usage["totalRuns"], 2);
    assert_eq!(usage["queuedRuns"], 1);
    assert_eq!(usage["canceledRuns"], 1);
    assert_eq!(usage["failedRuns"], 0);
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
