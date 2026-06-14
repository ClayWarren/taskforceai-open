use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc;

use super::{
    csrf_cookie_from_set_cookie, csrf_url_for_base, message_from_json_response, normalize_base_url,
    ApiClient, ApiDeviceLoginPoll, ApiSubmitMcpServer, ApiSubmitMcpTool, ApiSubmitRunRequest,
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
fn message_response_uses_fallback_for_success_envelopes() {
    assert_eq!(
        message_from_json_response(&json!({ "success": true }), "Settings updated").as_deref(),
        Some("Settings updated")
    );
    assert_eq!(
        message_from_json_response(
            &json!({ "success": true, "message": "  Saved  " }),
            "Settings updated"
        )
        .as_deref(),
        Some("Saved")
    );
    assert!(message_from_json_response(&json!({ "success": false }), "Settings updated").is_none());
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
fn submit_run_body_matches_go_tui_options_shape() {
    let mut role_models = BTreeMap::new();
    role_models.insert("Researcher".to_string(), "gpt-5".to_string());
    let body = ApiSubmitRunRequest {
        prompt: "orchestrate robots".to_string(),
        model_id: Some("gpt-5".to_string()),
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
    assert_eq!(body["projectId"], 7);
    assert_eq!(body["attachment_ids"][0], "att-1");
    assert_eq!(body["role_models"]["Researcher"], "gpt-5");
    assert_eq!(body["budget"], 42.5);
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
