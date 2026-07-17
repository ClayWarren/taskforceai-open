use super::*;

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
    assert!(
        super::super::client::API_ATTACHMENT_UPLOAD_TIMEOUT
            > super::super::client::API_REQUEST_TIMEOUT
    );
    assert!(
        super::super::client::API_ATTACHMENT_UPLOAD_TIMEOUT >= std::time::Duration::from_secs(600)
    );
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
    let preview = super::super::preview_body(&format!(
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
            super::super::ApiSyncPullRequest {
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
            super::super::ApiSyncPushRequest {
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

#[tokio::test]
async fn desktop_api_bridge_forwards_versioned_path_and_response() {
    let (origin, server, paths) = start_sequence_server(vec![
        csrf_response(),
        status_response(201, r#"{"id":"agent-1"}"#),
    ]);
    let response = ApiClient::new(format!("{origin}/api/v1"))
        .request_json(
            "desktop-token",
            ApiRequestParams {
                method: "POST".to_string(),
                path: "/api/v1/agents?source=desktop".to_string(),
                body: Some(json!({"name": "Researcher"})),
            },
        )
        .await
        .expect("desktop API bridge request should succeed");

    assert_eq!(response.status, 201);
    assert_eq!(response.body, Some(json!({"id": "agent-1"})));
    server.join().expect("API sequence server should finish");
    let paths = paths.lock().expect("paths should be recorded");
    assert_eq!(
        paths.as_slice(),
        ["/api/auth/csrf", "/api/v1/agents?source=desktop"]
    );
}

#[tokio::test]
async fn desktop_api_bridge_handles_empty_and_invalid_json_responses() {
    let (origin, server, _) =
        start_sequence_server(vec![csrf_response(), status_response(204, "")]);
    let response = ApiClient::new(format!("{origin}/api/v1"))
        .request_json(
            "desktop-token",
            ApiRequestParams {
                method: "POST".to_string(),
                path: "/api/v1/agents".to_string(),
                body: None,
            },
        )
        .await
        .expect("empty desktop API response should succeed");
    assert_eq!(response.status, 204);
    assert_eq!(response.body, None);
    server.join().expect("empty response server should finish");

    let (origin, server, _) =
        start_sequence_server(vec![csrf_response(), status_response(200, "not-json")]);
    let error = ApiClient::new(format!("{origin}/api/v1"))
        .request_json(
            "desktop-token",
            ApiRequestParams {
                method: "POST".to_string(),
                path: "/api/v1/agents".to_string(),
                body: None,
            },
        )
        .await
        .expect_err("invalid desktop API JSON should fail");
    assert!(error.to_string().contains("desktop api bridge"));
    server
        .join()
        .expect("invalid response server should finish");
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
        permission_profile: Some(PermissionProfile::WorkspaceWrite),
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
    assert_eq!(body["options"]["permissionProfile"], "workspace_write");
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
        permission_profile: None,
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
