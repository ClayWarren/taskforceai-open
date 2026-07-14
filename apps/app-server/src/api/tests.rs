use std::collections::BTreeMap;
use std::fmt::Debug;
use std::future::Future;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc;

use super::{
    csrf_cookie_from_set_cookie, csrf_url_for_base, normalize_base_url, ApiClient,
    ApiDeviceLoginPoll, ApiSubmitMcpServer, ApiSubmitMcpTool, ApiSubmitRunRequest,
    ApiSubmitRunResponse, DEFAULT_API_BASE_URL,
};

#[test]
fn normalizes_base_url() {
    assert_eq!(
        normalize_base_url("https://www.taskforceai.chat/api/v1///"),
        DEFAULT_API_BASE_URL
    );
}

#[test]
fn client_exposes_normalized_base_url() {
    let client = ApiClient::new("https://example.com/api/v1/");

    assert_eq!(client.base_url(), "https://example.com/api/v1");
}

#[test]
fn attachment_upload_timeout_allows_large_files() {
    assert!(super::client::API_ATTACHMENT_UPLOAD_TIMEOUT > super::client::API_REQUEST_TIMEOUT);
    assert!(super::client::API_ATTACHMENT_UPLOAD_TIMEOUT >= std::time::Duration::from_secs(600));
}

#[test]
fn derives_csrf_url_from_api_base() {
    assert_eq!(
        csrf_url_for_base("https://www.taskforceai.chat/api/v1").unwrap(),
        "https://www.taskforceai.chat/api/auth/csrf"
    );
}

#[test]
fn extracts_csrf_cookie_from_set_cookie_header() {
    assert_eq!(
        csrf_cookie_from_set_cookie("csrf_token=abc-123; Path=/; Secure").as_deref(),
        Some("csrf_token=abc-123")
    );
    assert!(csrf_cookie_from_set_cookie("other=value; Path=/").is_none());
}

#[test]
fn submit_run_response_accepts_engine_response_shape() {
    let response: ApiSubmitRunResponse = serde_json::from_value(json!({
        "task_id": "task_123",
        "status": "processing",
        "conversation_id": 117
    }))
    .unwrap();

    assert_eq!(response.task_id, "task_123");
    assert_eq!(response.conversation_id.as_deref(), Some("117"));
}

#[test]
fn preview_body_collapses_whitespace_and_limits_length() {
    let preview = super::preview_body(&format!(
        "<html>\n  <body>{}</body>\n</html>",
        "x".repeat(400)
    ));

    assert!(preview.starts_with("<html> <body>"));
    assert_eq!(preview.chars().count(), 240);
    assert!(!preview.contains('\n'));
}

#[test]
fn device_login_poll_accepts_camel_case_access_token() {
    let response: ApiDeviceLoginPoll = serde_json::from_value(json!({
        "status": "approved",
        "accessToken": "approved-token",
        "expires_in": 3600
    }))
    .unwrap();

    assert_eq!(response.status, "approved");
    assert_eq!(response.access_token.as_deref(), Some("approved-token"));
}

#[test]
fn device_login_poll_accepts_compat_access_token_pair() {
    let response: ApiDeviceLoginPoll = serde_json::from_value(json!({
        "status": "approved",
        "access_token": "approved-token",
        "accessToken": "approved-token",
        "expires_in": 3600
    }))
    .unwrap();

    assert_eq!(response.status, "approved");
    assert_eq!(response.access_token.as_deref(), Some("approved-token"));
}

#[test]
fn device_login_poll_prefers_non_empty_access_token() {
    let response: ApiDeviceLoginPoll = serde_json::from_value(json!({
        "status": "approved",
        "access_token": "",
        "accessToken": "approved-token"
    }))
    .unwrap();

    assert_eq!(response.access_token.as_deref(), Some("approved-token"));
}

#[tokio::test]
async fn device_login_poll_decodes_slow_down_outcome() {
    let (base_url, server, _) = start_sequence_server(vec![
        csrf_response(),
        status_response(
            429,
            r#"{"status":"slow_down","interval":5,"message":"slow_down"}"#,
        ),
    ]);
    let response = ApiClient::new(base_url)
        .poll_device_login("device-code")
        .await
        .expect("slow-down is a device login outcome");

    assert_eq!(response.status, "slow_down");
    assert_eq!(response.interval, Some(5));
    server.join().expect("API sequence server should finish");
}

#[tokio::test]
async fn versioned_api_base_is_not_duplicated_for_models_or_sync() {
    let (origin, server, paths) = start_sequence_server(vec![
        response(r#"{"enabled":true,"options":[],"defaultModelId":"sentinel"}"#),
        csrf_response(),
        response(r#"{"conversations":[],"messages":[],"deletions":[],"latestVersion":1}"#),
        csrf_response(),
        response(r#"{"accepted":[],"conflicts":[],"newVersion":2}"#),
    ]);
    let client = ApiClient::new(format!("{origin}/api/v1"));

    client.list_models().await.expect("models should load");
    client
        .sync_pull(
            "token",
            super::ApiSyncPullRequest {
                device_id: "device".to_string(),
                last_sync_version: 0,
                limit: Some(1),
            },
        )
        .await
        .expect("sync pull should succeed");
    client
        .sync_push(
            "token",
            super::ApiSyncPushRequest {
                conversations: Vec::new(),
                messages: Vec::new(),
                deletions: Vec::new(),
                device_id: "device".to_string(),
            },
        )
        .await
        .expect("sync push should succeed");

    server.join().expect("API sequence server should finish");
    let paths = paths.lock().expect("paths should be recorded");
    assert_eq!(
        paths.as_slice(),
        [
            "/api/v1/models",
            "/api/auth/csrf",
            "/api/v1/sync/pull",
            "/api/auth/csrf",
            "/api/v1/sync/push",
        ]
    );
}

#[test]
fn submit_run_body_matches_go_tui_options_shape() {
    let mut role_models = BTreeMap::new();
    role_models.insert("Researcher".to_string(), "gpt-5".to_string());
    let body = ApiSubmitRunRequest {
        prompt: "orchestrate robots".to_string(),
        model_id: Some("gpt-5".to_string()),
        reasoning_effort: Some("high".to_string()),
        quick_mode: true,
        autonomous: true,
        computer_use: true,
        computer_use_target: Some("virtual".to_string()),
        use_logged_in_services: true,
        agent_count: Some(1),
        project_id: Some(7),
        attachment_ids: vec!["att-1".to_string()],
        role_models,
        budget: Some(42.5),
        mcp_servers: vec![ApiSubmitMcpServer {
            name: "files".to_string(),
            tools: vec!["read".to_string()],
            enabled: true,
        }],
        client_mcp_tools: vec![
            ApiSubmitMcpTool {
                server_name: "docs".to_string(),
                tool_name: "lookup".to_string(),
                title: Some("Lookup".to_string()),
                description: Some("Find docs".to_string()),
            },
            ApiSubmitMcpTool {
                server_name: "workspace".to_string(),
                tool_name: "write_file".to_string(),
                title: Some("Write file".to_string()),
                description: Some("Write a file in the active workspace".to_string()),
            },
        ],
        private_chat: true,
        research_workflow: Some(json!({
            "workflow": "investment_dossier",
            "requiredCitations": true,
            "preferredExports": ["docx", "pdf"],
            "sourcePolicy": "public_and_attached"
        })),
    }
    .to_body();

    assert_eq!(body["prompt"], "orchestrate robots");
    assert_eq!(body["modelId"], "gpt-5");
    assert_eq!(body["reasoningEffort"], "high");
    assert_eq!(body["projectId"], 7);
    assert_eq!(body["attachment_ids"][0], "att-1");
    assert_eq!(body["role_models"]["Researcher"], "gpt-5");
    assert_eq!(body["budget"], 42.5);
    assert_eq!(body["private_chat"], true);
    assert_eq!(body["options"]["quickModeEnabled"], false);
    assert_eq!(body["options"]["autonomyEnabled"], true);
    assert_eq!(body["options"]["computerUseEnabled"], true);
    assert_eq!(body["options"]["computerUseTarget"], "virtual");
    assert_eq!(body["options"]["useLoggedInServices"], true);
    assert_eq!(body["options"]["agentCount"], 1);
    assert_eq!(
        body["options"]["clientTools"]["mcp"][0]["serverName"],
        "files"
    );
    assert_eq!(body["options"]["clientTools"]["mcp"][0]["toolName"], "read");
    assert_eq!(
        body["options"]["clientTools"]["mcp"][1]["serverName"],
        "docs"
    );
    assert_eq!(
        body["options"]["clientTools"]["mcp"][1]["toolName"],
        "lookup"
    );
    assert_eq!(
        body["options"]["clientTools"]["mcp"][1]["description"],
        "Find docs"
    );
    assert_eq!(
        body["options"]["researchWorkflow"]["workflow"],
        "investment_dossier"
    );
    assert_eq!(
        body["options"]["researchWorkflow"]["requiredCitations"],
        true
    );
}

#[test]
fn submit_run_body_filters_invalid_and_sensitive_mcp_tools() {
    let body = ApiSubmitRunRequest {
        prompt: "filter tools".to_string(),
        model_id: Some(String::new()),
        reasoning_effort: None,
        quick_mode: true,
        autonomous: false,
        computer_use: false,
        computer_use_target: None,
        use_logged_in_services: false,
        agent_count: Some(0),
        project_id: None,
        attachment_ids: Vec::new(),
        role_models: BTreeMap::new(),
        budget: Some(0.0),
        mcp_servers: vec![
            ApiSubmitMcpServer {
                name: "   ".to_string(),
                tools: vec!["read".to_string()],
                enabled: true,
            },
            ApiSubmitMcpServer {
                name: "workspace".to_string(),
                tools: vec!["write_file".to_string(), "  ".to_string()],
                enabled: true,
            },
            ApiSubmitMcpServer {
                name: "docs".to_string(),
                tools: vec!["lookup".to_string()],
                enabled: false,
            },
        ],
        client_mcp_tools: Vec::new(),
        private_chat: false,
        research_workflow: None,
    }
    .to_body();

    assert_eq!(body["prompt"], "filter tools");
    assert_eq!(body["options"]["quickModeEnabled"], true);
    assert!(body["modelId"].is_null());
    assert!(body["budget"].is_null());
    assert!(body["options"].get("clientTools").is_none());
}

#[test]
fn submit_run_response_optional_conversation_id_accepts_strings_and_empty_values() {
    let string_id: ApiSubmitRunResponse = serde_json::from_value(json!({
        "task_id": "task-string",
        "conversation_id": "conversation-1"
    }))
    .expect("string conversation id should deserialize");
    assert_eq!(string_id.conversation_id.as_deref(), Some("conversation-1"));

    let empty_id: ApiSubmitRunResponse = serde_json::from_value(json!({
        "task_id": "task-empty",
        "conversation_id": ""
    }))
    .expect("empty conversation id should deserialize");
    assert_eq!(empty_id.conversation_id, None);
}

#[tokio::test]
async fn stream_run_events_preserves_split_utf8_chunks() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("sse server should bind");
    let address = listener
        .local_addr()
        .expect("sse address should be readable");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("sse client should connect");
        let mut request = [0_u8; 1024];
        let _ = stream
            .read(&mut request)
            .expect("request should be readable");
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            )
            .expect("headers should write");

        let frame = b"data: {\"type\":\"progress\",\"chunk\":\"caf\xc3\xa9\"}\n\n";
        let split = frame
            .iter()
            .position(|byte| *byte == 0xc3)
            .expect("frame should contain split byte")
            + 1;
        stream
            .write_all(&frame[..split])
            .expect("first frame chunk should write");
        stream.flush().expect("first frame chunk should flush");
        thread::sleep(Duration::from_millis(50));
        stream
            .write_all(&frame[split..])
            .expect("second frame chunk should write");
        stream.flush().expect("second frame chunk should flush");
    });

    let client = ApiClient::new(format!("http://{address}"));
    let (sender, mut receiver) = mpsc::channel(1);
    client
        .stream_run_events_to_sender("token", "task/split", sender)
        .await
        .expect("stream should decode");
    let event = receiver.recv().await.expect("event should be sent");

    assert_eq!(event.event_type, "progress");
    assert_eq!(event.chunk, "café");
    server.join().expect("sse server should finish");
}

#[tokio::test]
async fn stream_run_events_flushes_final_frame_and_stops_when_receiver_closes() {
    let (base_url, first_server, _) = start_sequence_server(vec![response(
        r#"data: {"type":"progress","chunk":"tail"}"#,
    )]);
    let client = ApiClient::new(&base_url);
    let (sender, mut receiver) = mpsc::channel(1);

    client
        .stream_run_events_to_sender("token", "task-tail", sender)
        .await
        .expect("stream should flush final frame");
    let event = receiver.recv().await.expect("tail event should be sent");
    assert_eq!(event.event_type, "progress");
    assert_eq!(event.chunk, "tail");
    first_server
        .join()
        .expect("tail stream server should finish");

    let (base_url, second_server, _) = start_sequence_server(vec![response(
        r#"data: {"type":"progress","chunk":"closed"}

"#,
    )]);
    let client = ApiClient::new(&base_url);
    let (sender, receiver) = mpsc::channel(1);
    drop(receiver);

    client
        .stream_run_events_to_sender("token", "task-closed", sender)
        .await
        .expect("closed receiver should stop the stream cleanly");
    second_server
        .join()
        .expect("closed receiver stream server should finish");
}

#[tokio::test]
async fn list_models_reports_invalid_json_with_context() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("api server should bind");
    let address = listener
        .local_addr()
        .expect("api address should be readable");
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("api client should connect");
        let mut request = [0_u8; 1024];
        let _ = stream
            .read(&mut request)
            .expect("request should be readable");
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"enabled\":",
            )
            .expect("response should write");
        stream.flush().expect("response should flush");
    });

    let client = ApiClient::new(format!("http://{address}"));
    let error = client
        .list_models()
        .await
        .expect_err("malformed model list should fail");
    let message = error.to_string();

    assert!(message.contains("unexpected model list response"));
    assert!(message.contains("body preview: {\"enabled\":"));
    server.join().expect("api server should finish");
}

#[tokio::test]
async fn api_client_success_paths_use_expected_routes_and_payloads() {
    let artifact = json!({
        "id": "artifact-1",
        "title": "Launch Plan",
        "type": "document",
        "status": "ready",
        "visibility": "private",
        "currentVersionId": "version-1",
        "currentVersion": artifact_version_json()
    });
    let project = json!({
        "id": 42,
        "name": "Ops",
        "description": "Launch operations",
        "customInstructions": "Stay concise",
        "createdAt": "2026-07-01T00:00:00Z"
    });
    let (base_url, server, paths) = start_sequence_server(vec![
        response("{}"),
        csrf_response(),
        response(
            r#"{"device_code":"device","user_code":"USER","verification_uri":"https://example.com/device","verification_uri_complete":"https://example.com/device?user_code=USER","expires_in":600,"interval":5}"#,
        ),
        csrf_response(),
        response(
            r#"{"status":"approved","access_token":"token","accessToken":"token","expires_in":3600}"#,
        ),
        csrf_response(),
        response("{}"),
        csrf_response(),
        response("{}"),
        csrf_response(),
        response("{}"),
        response(
            r#"{"enabled":true,"options":[{"id":"sentinel","label":"Sentinel","badge":"fast","description":"Frontier","usageMultiple":1.5}],"defaultModelId":"sentinel"}"#,
        ),
        csrf_response(),
        response(r#"{"conversations":[],"messages":[],"deletions":[],"latestVersion":7}"#),
        csrf_response(),
        response(r#"{"accepted":["conversation-1"],"conflicts":[],"newVersion":8}"#),
        response(r#"{"messages":[{"type":"conversation.updated"}],"lastId":"event-2"}"#),
        response(&json!([project.clone()]).to_string()),
        csrf_response(),
        response(&project.to_string()),
        csrf_response(),
        response("{}"),
        response(r#"{"email":"ops@example.com","name":"Operator","notifications_enabled":true}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Settings saved"}"#),
        response(r#"{"providers":[{"id":"github","connected":true}]}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Integration removed"}"#),
        response(r#"{"plan":"pro","status":"active"}"#),
        response(r#"{"balance":12.5}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Subscription canceled"}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Subscription reactivated"}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Plan updated"}"#),
        response(r#"{"exports":[]}"#),
        csrf_response(),
        response(r#"{"success":true,"message":"Account deleted"}"#),
        response(&json!([artifact.clone()]).to_string()),
        response(&artifact.to_string()),
        response(&json!([artifact_version_json()]).to_string()),
        csrf_response(),
        response(
            &json!({
                "token": "public-token",
                "url": "https://www.taskforceai.chat/artifacts/public-token",
                "artifact": artifact
            })
            .to_string(),
        ),
        response("download-bytes"),
        csrf_response(),
        response("{}"),
    ]);
    let client = ApiClient::new(&base_url);

    assert_eq!(client.check_health().await.expect("health").status, 200);
    assert_eq!(
        client
            .start_device_login()
            .await
            .expect("start device login")
            .device_code,
        "device"
    );
    assert_eq!(
        client
            .poll_device_login("device")
            .await
            .expect("poll device login")
            .access_token
            .as_deref(),
        Some("token")
    );
    client
        .cancel_run("token", "task/with space")
        .await
        .expect("cancel run");
    client
        .respond_to_run_approval(
            "token",
            "task/with space",
            true,
            Some(json!({"approved": true})),
            None,
        )
        .await
        .expect("respond to approval");
    client
        .steer_run("token", "task/with space", "focus on protocol")
        .await
        .expect("steer run");
    assert_eq!(
        client
            .list_models()
            .await
            .expect("models")
            .options
            .first()
            .expect("model")
            .id,
        "sentinel"
    );
    assert_eq!(
        client
            .sync_pull(
                "token",
                super::ApiSyncPullRequest {
                    device_id: "device-1".to_string(),
                    last_sync_version: 6,
                    limit: Some(10),
                },
            )
            .await
            .expect("sync pull")
            .latest_version,
        7
    );
    assert_eq!(
        client
            .sync_push(
                "token",
                super::ApiSyncPushRequest {
                    conversations: vec![json!({"id": "conversation-1"})],
                    messages: Vec::new(),
                    deletions: Vec::new(),
                    device_id: "device-1".to_string(),
                },
            )
            .await
            .expect("sync push")
            .new_version,
        8
    );
    assert_eq!(
        client
            .sync_realtime_poll("token", Some("event/1"))
            .await
            .expect("sync realtime")
            .last_id,
        "event-2"
    );
    assert_eq!(
        client.list_projects("token").await.expect("projects")[0].id,
        42
    );
    assert_eq!(
        client
            .create_project(
                "token",
                super::ApiCreateProjectRequest {
                    name: "Ops".to_string(),
                    description: None,
                    custom_instructions: None,
                },
            )
            .await
            .expect("create project")
            .name,
        "Ops"
    );
    client
        .delete_project("token", 42)
        .await
        .expect("delete project");
    assert_eq!(
        client.current_user("token").await.expect("current user")["email"],
        "ops@example.com"
    );
    assert_eq!(
        client
            .update_settings("token", json!({"notifications_enabled": false}))
            .await
            .expect("update settings"),
        "Settings saved"
    );
    assert!(client.integrations("token").await.expect("integrations")["providers"].is_array());
    assert_eq!(
        client
            .disconnect_integration("token", "github")
            .await
            .expect("disconnect"),
        "Integration removed"
    );
    assert_eq!(
        client.subscription("token").await.expect("subscription")["plan"],
        "pro"
    );
    assert_eq!(
        client.billing_balance("token").await.expect("billing")["balance"],
        12.5
    );
    assert_eq!(
        client
            .cancel_subscription("token")
            .await
            .expect("cancel subscription"),
        "Subscription canceled"
    );
    assert_eq!(
        client
            .reactivate_subscription("token")
            .await
            .expect("reactivate subscription"),
        "Subscription reactivated"
    );
    assert_eq!(
        client.upgrade_plan("token", "pro").await.expect("upgrade"),
        "Plan updated"
    );
    assert_eq!(
        client.export_gdpr_data("token").await.expect("gdpr export"),
        r#"{"exports":[]}"#
    );
    assert_eq!(
        client
            .delete_account("token", "ops@example.com")
            .await
            .expect("delete account"),
        "Account deleted"
    );
    assert_eq!(
        client
            .list_artifacts("token", 10)
            .await
            .expect("artifact list")[0]
            .id,
        "artifact-1"
    );
    assert_eq!(
        client
            .get_artifact("token", "artifact-1")
            .await
            .expect("artifact")
            .title,
        "Launch Plan"
    );
    assert_eq!(
        client
            .list_artifact_versions("token", "artifact-1")
            .await
            .expect("versions")[0]
            .id,
        "version-1"
    );
    assert_eq!(
        client
            .create_artifact_public_link("token", "artifact-1")
            .await
            .expect("share")
            .token,
        "public-token"
    );
    assert_eq!(
        client
            .download_file_content("token", "file-1")
            .await
            .expect("download"),
        b"download-bytes"
    );
    client
        .delete_artifact("token", "artifact-1")
        .await
        .expect("delete artifact");

    server.join().expect("api sequence server should finish");
    let paths = paths.lock().expect("paths should be recorded");
    assert_eq!(paths[0], "/health");
    assert!(paths
        .iter()
        .any(|path| path == "/tasks/task%2Fwith%20space/cancel"));
    assert!(paths
        .iter()
        .any(|path| path == "/tasks/task%2Fwith%20space/approve"));
    assert!(paths
        .iter()
        .any(|path| path == "/tasks/task%2Fwith%20space/steer"));
    assert!(paths
        .iter()
        .any(|path| path == "/sync/realtime?last_id=event%2F1"));
    assert!(paths
        .iter()
        .any(|path| { path == "/artifacts?limit=10&offset=0&include=currentVersion" }));
}

#[tokio::test]
async fn remote_api_client_sends_credentials_and_escaped_routes() {
    let target = r#"{"deviceId":"desktop/1","deviceName":"Studio","allowConnections":true,"keepAwake":true,"lastSeenAt":"2026-07-13T00:00:00Z"}"#;
    let (base_url, server, paths) = start_sequence_server(vec![
        csrf_response(),
        response(target),
        csrf_response(),
        response(r#"{"code":"PAIR-123","expiresIn":600}"#),
        response(
            r#"{"devices":[{"deviceId":"mobile/1","deviceName":"Phone","userAgent":"TaskForceAI Mobile","lastConnectedAt":"2026-07-13T00:00:00Z","capabilities":["threads"]}]}"#,
        ),
        csrf_response(),
        response("{}"),
        response(r#"{"commands":[],"lastId":"command/2"}"#),
        response("{}"),
    ]);
    let client = ApiClient::new(base_url);

    let updated = client
        .remote_upsert_target("token", "desktop/1", "credential", "Studio", true, true)
        .await
        .expect("Remote target should update");
    assert_eq!(updated.device_id, "desktop/1");
    assert_eq!(
        client
            .remote_create_pairing_code("token", "desktop/1", "credential", "Studio")
            .await
            .expect("pairing code should create")
            .code,
        "PAIR-123"
    );
    assert_eq!(
        client
            .remote_list_controllers("token", "desktop/1", "credential")
            .await
            .expect("controllers should list")
            .devices[0]
            .device_id,
        "mobile/1"
    );
    client
        .remote_revoke_controller("token", "desktop/1", "credential", "mobile/1")
        .await
        .expect("controller should revoke");
    assert_eq!(
        client
            .remote_poll_commands("token", "desktop/1", "credential", "command/1")
            .await
            .expect("commands should poll")
            .last_id,
        "command/2"
    );
    client
        .remote_submit_result(
            "token",
            "desktop/1",
            "credential",
            "command/2",
            "mobile/1",
            &json!({"jsonrpc": "2.0", "id": 7, "result": {"ok": true}}),
        )
        .await
        .expect("command result should submit");

    server.join().expect("Remote API server should finish");
    let paths = paths.lock().expect("paths should be recorded");
    assert!(paths.iter().any(|path| path == "/remote/target"));
    assert!(paths.iter().any(|path| path == "/remote/pairing-code"));
    assert!(paths
        .iter()
        .any(|path| path == "/remote/controllers/mobile%2F1"));
    assert!(paths.iter().any(|path| {
        path == "/remote/devices/desktop%2F1/commands?lastId=command%2F1&waitMs=5000"
    }));
    assert!(paths
        .iter()
        .any(|path| { path == "/remote/devices/desktop%2F1/commands/command%2F2/result" }));
}

mod error_paths;

fn artifact_version_json() -> serde_json::Value {
    json!({
        "id": "version-1",
        "artifactId": "artifact-1",
        "version": 1,
        "fileId": "file-1",
        "filename": "launch-plan.md",
        "mimeType": "text/markdown",
        "bytes": 128,
        "createdAt": "2026-07-01T00:00:00Z"
    })
}

fn csrf_response() -> MockResponse {
    MockResponse {
        status: 200,
        body: r#"{"csrfToken":"csrf-token"}"#.to_string(),
        headers: vec![("Set-Cookie", "csrf_token=csrf-token; Path=/")],
    }
}

fn response(body: &str) -> MockResponse {
    MockResponse {
        status: 200,
        body: body.to_string(),
        headers: Vec::new(),
    }
}

fn status_response(status: u16, body: &str) -> MockResponse {
    MockResponse {
        status,
        body: body.to_string(),
        headers: Vec::new(),
    }
}

struct MockResponse {
    status: u16,
    body: String,
    headers: Vec<(&'static str, &'static str)>,
}

fn start_sequence_server(
    responses: Vec<MockResponse>,
) -> (String, thread::JoinHandle<()>, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("sequence server should bind");
    let address = listener
        .local_addr()
        .expect("sequence address should be readable");
    let paths = Arc::new(Mutex::new(Vec::new()));
    let recorded_paths = Arc::clone(&paths);
    let handle = thread::spawn(move || {
        for mock_response in responses {
            let (mut stream, _) = listener.accept().expect("request should connect");
            recorded_paths
                .lock()
                .expect("paths lock should not poison")
                .push(read_request_path(&mut stream));
            let status_text = if mock_response.status == 200 {
                "OK"
            } else {
                "Error"
            };
            let mut response = format!(
                "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                mock_response.status,
                status_text,
                mock_response.body.len()
            );
            for (name, value) in mock_response.headers {
                response.push_str(name);
                response.push_str(": ");
                response.push_str(value);
                response.push_str("\r\n");
            }
            response.push_str("\r\n");
            response.push_str(&mock_response.body);
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
        }
    });
    (format!("http://{address}"), handle, paths)
}

async fn expect_error<T, F, Fut>(responses: Vec<MockResponse>, call: F, expected: &str)
where
    T: Debug,
    F: FnOnce(ApiClient) -> Fut,
    Fut: Future<Output = Result<T, super::ApiClientError>>,
{
    let (base_url, server, _) = start_sequence_server(responses);
    let client = ApiClient::new(base_url);
    let err = call(client)
        .await
        .expect_err("API client call should fail for mocked error response");
    let message = err.to_string();
    assert!(
        message
            .to_ascii_lowercase()
            .contains(&expected.to_ascii_lowercase()),
        "expected {message:?} to contain {expected:?}"
    );
    server.join().expect("error sequence server should finish");
}

fn read_request_path(stream: &mut std::net::TcpStream) -> String {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let read = stream.read(&mut chunk).expect("request should be readable");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buffer);
    text.lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_string()
}
