use super::support::{
    json_response, result_value, start_recording_response_sequence_server, test_store_path,
    MockHttpResponse,
};
use super::*;

#[test]
fn initialize_advertises_tui_ready_capabilities() {
    let runtime = AppRuntime::new(RuntimeConfig::default());
    let result = result_value(runtime.initialize());

    assert_eq!(result["capabilities"]["runs"], true);
    assert_eq!(result["capabilities"]["history"], true);
    assert_eq!(result["capabilities"]["attachments"], true);
    assert_eq!(result["capabilities"]["events"], true);
    assert_eq!(result["capabilities"]["agentSessions"], true);
    assert_eq!(result["capabilities"]["diagnostics"], true);
    assert_eq!(result["capabilities"]["channels"], true);
    assert_eq!(result["capabilities"]["schedules"], true);
    assert_eq!(result["capabilities"]["workflows"], true);
}

#[test]
fn attachment_list_and_clear_report_pending_limit() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let result = result_value(runtime.attachment_list());
    assert_eq!(
        result["attachments"].as_array().expect("attachments").len(),
        0
    );
    assert_eq!(result["maxAttachments"], 5);

    let result = result_value(runtime.attachment_clear());
    assert_eq!(
        result["attachments"].as_array().expect("attachments").len(),
        0
    );
    assert_eq!(result["maxAttachments"], 5);
}

#[tokio::test]
async fn attachment_add_requires_login_before_file_read() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let path = test_store_path("attachment-note").with_extension("txt");
    fs::write(&path, "hello from attachment").expect("attachment fixture should write");

    let err = runtime
        .attachment_add(AttachmentAddParams {
            path: path.display().to_string(),
        })
        .await
        .expect_err("upload should require login");

    assert_eq!(err.code, -32010);
    assert_eq!(err.message, "login required to upload attachments");
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn attachment_add_rejects_limit_empty_path_and_directories_before_upload() {
    let mut limited = AppRuntime::new(RuntimeConfig::default());
    for index in 0..MAX_PENDING_ATTACHMENTS {
        limited
            .active_attachments
            .push(crate::protocol::AttachmentRecord {
                id: format!("att-{index}"),
                name: format!("attachment-{index}.txt"),
                path: format!("/tmp/attachment-{index}.txt"),
                mime_type: "text/plain".to_string(),
                size: 1,
            });
    }
    let limit_err = limited
        .attachment_add(AttachmentAddParams {
            path: "/tmp/unused.txt".to_string(),
        })
        .await
        .expect_err("attachment limit should fail before file IO");
    assert_eq!(limit_err.code, -32602);
    assert!(limit_err.message.contains("attachment limit reached"));

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let empty_err = runtime
        .attachment_add(AttachmentAddParams {
            path: "   ".to_string(),
        })
        .await
        .expect_err("empty attachment path should fail");
    assert_eq!(empty_err.message, "attachment path is required");

    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    let dir_path = test_store_path("attachment-directory");
    fs::create_dir_all(&dir_path).expect("attachment directory fixture should exist");
    let directory_err = runtime
        .attachment_add(AttachmentAddParams {
            path: dir_path.display().to_string(),
        })
        .await
        .expect_err("directory attachments should fail");
    assert_eq!(
        directory_err.message,
        "attachment path must reference a regular file"
    );

    let huge_path = test_store_path("attachment-huge").with_extension("mp4");
    fs::File::create(&huge_path)
        .expect("huge attachment fixture should create")
        .set_len((MAX_VIDEO_SIZE as u64) + 1)
        .expect("huge attachment fixture should be sparse");
    let huge_err = runtime
        .attachment_add(AttachmentAddParams {
            path: huge_path.display().to_string(),
        })
        .await
        .expect_err("metadata size should reject very large files");
    assert!(huge_err.message.contains("attachment too large"));

    let oversized_text_path = test_store_path("attachment-oversized-text").with_extension("txt");
    fs::File::create(&oversized_text_path)
        .expect("oversized text fixture should create")
        .set_len((MAX_DOCUMENT_SIZE as u64) + 1)
        .expect("oversized text fixture should be sparse");
    let oversized_text_err = runtime
        .attachment_add(AttachmentAddParams {
            path: oversized_text_path.display().to_string(),
        })
        .await
        .expect_err("document limit should reject oversized text");
    assert!(oversized_text_err.message.contains("attachment too large"));

    let unsupported_path = test_store_path("attachment-unsupported").with_extension("bin");
    fs::write(&unsupported_path, [0_u8, 1, 2, 3]).expect("unsupported fixture should write");
    let unsupported_err = runtime
        .attachment_add(AttachmentAddParams {
            path: unsupported_path.display().to_string(),
        })
        .await
        .expect_err("unsupported attachment type should fail");
    assert!(unsupported_err
        .message
        .contains("unsupported attachment type"));

    let _ = fs::remove_dir(dir_path);
    let _ = fs::remove_file(huge_path);
    let _ = fs::remove_file(oversized_text_path);
    let _ = fs::remove_file(unsupported_path);
}

#[tokio::test]
async fn attachment_add_uploads_supported_file_and_tracks_pending_attachment() {
    let path = test_store_path("attachment-upload").with_extension("txt");
    fs::write(&path, "hello from attachment").expect("attachment fixture should write");
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": "att-remote-1",
                "mime_type": "text/plain",
                "size": 21
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

    let uploaded = result_value(
        runtime
            .attachment_add(AttachmentAddParams {
                path: path.display().to_string(),
            })
            .await
            .expect("attachment should upload"),
    );

    assert_eq!(uploaded["attachment"]["id"], "att-remote-1");
    assert_eq!(uploaded["attachment"]["mimeType"], "text/plain");
    assert_eq!(uploaded["attachments"][0]["id"], "att-remote-1");
    server.join().expect("mock attachment server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/attachments/upload");
    assert_eq!(
        requests[1].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    assert!(requests[1].body.contains("attachment-upload"));
    assert!(requests[1].body.contains("hello from attachment"));

    let _ = fs::remove_file(path);
}

#[test]
fn attachment_type_detection_matches_tui_limits() {
    assert_eq!(
        detect_attachment_mime_type(PathBuf::from("image.png").as_path(), b"\x89PNG\r\n\x1a\n"),
        "image/png"
    );
    assert_eq!(
        detect_attachment_mime_type(PathBuf::from("note.md").as_path(), b"# Note\n"),
        "text/markdown"
    );
    assert_eq!(
        detect_attachment_mime_type(
            PathBuf::from("voice-note.m4a").as_path(),
            b"\0\0\0\x18ftypM4A \0\0\0\0"
        ),
        "audio/mp4"
    );
    assert!(allowed_attachment_mime_type("image/png"));
    assert!(allowed_attachment_mime_type("audio/mp4"));
    assert!(allowed_attachment_mime_type("text/markdown"));
    assert!(!allowed_attachment_mime_type("application/octet-stream"));
    assert_eq!(attachment_size_limit("image/png"), MAX_IMAGE_SIZE);
    assert_eq!(attachment_size_limit("audio/mpeg"), MAX_AUDIO_SIZE);
    assert_eq!(attachment_size_limit("video/mp4"), MAX_VIDEO_SIZE);
    assert_eq!(attachment_size_limit("application/json"), MAX_DOCUMENT_SIZE);
}

#[test]
fn plugin_manifest_scan_skips_large_dependency_directories() {
    let root = test_store_path("plugin-scan").with_extension("");
    let plugin_dir = root.join("plugins").join("local");
    let skipped_dir = root.join("node_modules").join("expensive");
    fs::create_dir_all(&plugin_dir).expect("plugin dir should be created");
    fs::create_dir_all(&skipped_dir).expect("skipped dir should be created");
    fs::write(
        plugin_dir.join("plugin.json"),
        r#"{"id":"local","name":"Local","description":"Local plugin"}"#,
    )
    .expect("plugin manifest should write");
    fs::write(
        skipped_dir.join("plugin.json"),
        r#"{"id":"dependency","name":"Dependency","description":"Skip me"}"#,
    )
    .expect("skipped manifest should write");

    let mut manifests = Vec::new();
    collect_named_files(&root, "plugin.json", 6, &mut manifests)
        .expect("plugin scan should complete");

    assert_eq!(manifests, vec![plugin_dir.join("plugin.json")]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn mcp_config_methods_round_trip_servers() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let added = result_value(
        runtime
            .mcp_add(McpServerAddParams {
                name: "files".to_string(),
                endpoint: "https://example.com/mcp".to_string(),
                tools: vec!["read".to_string(), "read".to_string(), "write".to_string()],
                enabled: true,
            })
            .expect("mcp add should work"),
    );
    assert_eq!(added["server"]["name"], "files");
    assert_eq!(added["server"]["tools"].as_array().expect("tools").len(), 2);

    let disabled = result_value(
        runtime
            .mcp_disable(McpServerParams {
                name: "files".to_string(),
            })
            .expect("mcp disable should work"),
    );
    assert_eq!(disabled["server"]["enabled"], false);

    let updated = result_value(
        runtime
            .mcp_tools(McpServerToolsParams {
                name: "files".to_string(),
                tools: vec!["search".to_string()],
            })
            .expect("mcp tools should work"),
    );
    assert_eq!(updated["server"]["tools"][0], "search");

    let listed = result_value(runtime.mcp_list().expect("mcp list should work"));
    assert_eq!(listed["servers"].as_array().expect("servers").len(), 1);

    runtime
        .mcp_remove(McpServerParams {
            name: "files".to_string(),
        })
        .expect("mcp remove should work");
    let listed = result_value(runtime.mcp_list().expect("mcp list should work"));
    assert_eq!(listed["servers"].as_array().expect("servers").len(), 0);
}

#[test]
fn mcp_endpoint_parser_matches_supported_go_tui_shapes() {
    let streamable = parse_mcp_endpoint("https://example.com/mcp").expect("http endpoint");
    assert_eq!(streamable.kind, "streamable_http");

    let sse = parse_mcp_endpoint("sse+https://example.com/events").expect("sse endpoint");
    assert_eq!(sse.kind, "sse");

    let stdio_url =
        parse_mcp_endpoint("stdio://npx?arg=-y&arg=@modelcontextprotocol/server-memory")
            .expect("stdio url endpoint");
    assert_eq!(stdio_url.kind, "stdio");
    assert_eq!(stdio_url.command.as_deref(), Some("npx"));
    assert_eq!(
        stdio_url.args,
        vec!["-y", "@modelcontextprotocol/server-memory"]
    );

    let command = parse_mcp_endpoint(
        r#"stdio:npx -y "@modelcontextprotocol/server-filesystem" "/tmp/work dir""#,
    )
    .expect("command endpoint");
    assert_eq!(command.kind, "stdio");
    assert_eq!(command.command.as_deref(), Some("npx"));
    assert_eq!(
        command.args,
        vec![
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "/tmp/work dir"
        ]
    );

    let unsupported =
        parse_mcp_endpoint("ftp://example.com/mcp").expect_err("unsupported scheme should fail");
    assert_eq!(unsupported.code, -32602);
}

#[tokio::test]
async fn mcp_inspect_reports_parsed_transport() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .mcp_add(McpServerAddParams {
            name: "memory".to_string(),
            endpoint: "stdio://npx?arg=-y&arg=@modelcontextprotocol/server-memory".to_string(),
            tools: vec!["remember".to_string()],
            enabled: true,
        })
        .expect("mcp add should work");

    let inspected = result_value(
        runtime
            .mcp_inspect(McpServerParams {
                name: "memory".to_string(),
            })
            .await
            .expect("inspect should work"),
    );

    assert_eq!(inspected["transport"], "stdio");
    assert_eq!(inspected["command"], "npx");
    assert_eq!(inspected["args"][0], "-y");
}

#[test]
fn orchestration_methods_round_trip_role_models_and_budget() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let initial = result_value(
        runtime
            .orchestration_get()
            .expect("orchestration get should work"),
    );
    assert_eq!(initial["orchestration"]["budget"], serde_json::Value::Null);
    assert_eq!(
        initial["orchestration"]["roles"]
            .as_array()
            .expect("roles")
            .len(),
        4
    );

    let updated = result_value(
        runtime
            .orchestration_set_role(OrchestrationRoleSetParams {
                role: "researcher".to_string(),
                model_id: "gpt-5".to_string(),
            })
            .expect("role should update"),
    );
    assert_eq!(updated["orchestration"]["roles"][0]["name"], "Researcher");
    assert_eq!(updated["orchestration"]["roles"][0]["modelId"], "gpt-5");

    let budget = result_value(
        runtime
            .orchestration_set_budget(OrchestrationBudgetSetParams { budget: 50.0 })
            .expect("budget should update"),
    );
    assert_eq!(budget["orchestration"]["budget"], 50.0);

    let cleared = result_value(
        runtime
            .orchestration_clear()
            .expect("orchestration clear should work"),
    );
    assert_eq!(cleared["orchestration"]["budget"], serde_json::Value::Null);
    assert_eq!(
        cleared["orchestration"]["roles"][0]["modelId"],
        serde_json::Value::Null
    );
}

#[test]
fn hybrid_mode_uses_local_ollama_role_without_remote_role_leak() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let enabled = result_value(
        runtime
            .hybrid_mode_set(HybridModeSetParams {
                enabled: true,
                model_id: Some("ollama/gemma4:e4b".to_string()),
                role: None,
            })
            .expect("hybrid should enable"),
    );
    assert_eq!(enabled["enabled"], true);
    assert_eq!(enabled["role"], "Skeptic");
    assert_eq!(enabled["modelId"], "ollama/gemma4:e4b");

    let config = runtime
        .orchestration_config()
        .expect("orchestration should load");
    assert_eq!(
        orchestration_role_models(&config).get("Skeptic"),
        Some(&"ollama/gemma4:e4b".to_string())
    );
    assert!(!remote_orchestration_role_models(&config).contains_key("Skeptic"));
    let reviewer =
        hybrid_local_reviewer(&config, "http://localhost:11434/v1").expect("local reviewer");
    assert_eq!(reviewer.role, "Skeptic");
    assert_eq!(reviewer.model_id, "ollama/gemma4:e4b");

    let disabled = result_value(
        runtime
            .hybrid_mode_set(HybridModeSetParams {
                enabled: false,
                model_id: None,
                role: None,
            })
            .expect("hybrid should disable"),
    );
    assert_eq!(disabled["enabled"], false);
    assert_eq!(disabled["modelId"], serde_json::Value::Null);
}

#[test]
fn hybrid_local_review_appends_non_blocking_side_result() {
    let mut run = RunRecord {
        id: "run-hybrid".to_string(),
        prompt: "Build the thing".to_string(),
        model_id: Some("gpt-5".to_string()),
        project_id: None,
        status: RunStatus::Completed,
        output: Some("Cloud answer".to_string()),
        error: None,
        created_at: 1,
        updated_at: 1,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };
    run = apply_hybrid_local_review(
        run,
        Ok((
            HybridLocalReviewer {
                role: "Skeptic".to_string(),
                model_id: "ollama/gemma4:e4b".to_string(),
                base_url: "http://localhost:11434/v1".to_string(),
            },
            "Watch the migration risk.".to_string(),
        )),
    );

    assert!(run
        .output
        .as_deref()
        .expect("output")
        .contains("Local reviewer (ollama/gemma4:e4b):"));
    assert_eq!(run.tool_events[0]["toolName"], "hybrid.localReviewer");
    assert_eq!(run.tool_events[0]["success"], true);
    assert_eq!(run.agent_statuses[0]["agent"], "Skeptic");

    let failed = apply_hybrid_local_review(run, Err("ollama unavailable".to_string()));
    assert_eq!(failed.tool_events[1]["success"], false);
    assert_eq!(failed.status, RunStatus::Completed);
}

#[test]
fn local_settings_methods_round_trip_theme_telemetry_and_logging() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let initial = result_value(
        runtime
            .local_settings_get()
            .expect("settings get should work"),
    );
    assert_eq!(initial["settings"]["theme"], "system");
    assert_eq!(initial["settings"]["loggingLevel"], "info");

    let updated = result_value(
        runtime
            .local_settings_update(LocalSettingsUpdateParams {
                theme: Some("dark".to_string()),
                telemetry_enabled: Some(true),
                telemetry_dsn: Some("https://public@example.com/1".to_string()),
                telemetry_environment: Some("staging".to_string()),
                logging_level: Some("debug".to_string()),
                logging_format: Some("json".to_string()),
                memory_enabled: Some(false),
                ..Default::default()
            })
            .expect("settings update should work"),
    );
    assert_eq!(updated["settings"]["theme"], "dark");
    assert_eq!(updated["settings"]["telemetryEnabled"], true);
    assert_eq!(updated["settings"]["telemetryEnvironment"], "staging");
    assert_eq!(updated["settings"]["loggingLevel"], "debug");
    assert_eq!(updated["settings"]["loggingFormat"], "json");
    assert_eq!(updated["settings"]["memoryEnabled"], false);

    let err = runtime
        .local_settings_update(LocalSettingsUpdateParams {
            theme: Some("neon".to_string()),
            ..Default::default()
        })
        .expect_err("invalid theme should fail");
    assert_eq!(err.code, -32602);
}

#[tokio::test]
async fn remote_settings_commands_cover_account_subscription_data_and_apps() {
    let user = json!({
        "email": "ops@example.com",
        "full_name": "Ops Lead",
        "plan": "pro",
        "theme_preference": "dark",
        "notifications_enabled": true,
        "memory_enabled": true,
        "web_search_enabled": true,
        "code_execution_enabled": false,
        "trust_layer_enabled": true,
        "quick_mode_enabled": false,
        "subscription_status": "active",
        "subscription_source": "stripe"
    });
    let csrf = || MockHttpResponse {
        body: json!({ "csrfToken": "test-csrf" }).to_string(),
        headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
    };
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(user.to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Notifications saved" }).to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Personalization saved" }).to_string()),
        json_response(user.to_string()),
        json_response(
            json!({
                "subscription": {
                    "cancel_at_period_end": false
                }
            })
            .to_string(),
        ),
        csrf(),
        json_response(json!({ "success": true, "message": "Subscription canceled" }).to_string()),
        csrf(),
        json_response(
            json!({ "success": true, "message": "Subscription reactivated" }).to_string(),
        ),
        csrf(),
        json_response(json!({ "success": true, "message": "Plan updated" }).to_string()),
        json_response(user.to_string()),
        json_response(user.to_string()),
        csrf(),
        json_response(json!({ "success": true, "message": "Account deleted" }).to_string()),
        json_response(
            json!([
                {"provider": "github", "connected": true},
                {"provider": "slack", "connected": false}
            ])
            .to_string(),
        ),
        csrf(),
        json_response(
            json!({ "success": true, "message": "Integration disconnected" }).to_string(),
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

    let account = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "account".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("account settings should load"),
    );
    assert!(account["message"]
        .as_str()
        .expect("message")
        .contains("Ops Lead"));

    let notifications = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "notifications".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("notification settings should load"),
    );
    assert!(notifications["message"]
        .as_str()
        .expect("message")
        .contains("Notifications: on"));
    let notifications_saved = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "notifications".to_string(),
                args: vec!["off".to_string()],
            })
            .await
            .expect("notification settings should save"),
    );
    assert_eq!(notifications_saved["message"], "Notifications saved");

    let personalization = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "personalization".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("personalization settings should load"),
    );
    assert!(personalization["message"]
        .as_str()
        .expect("message")
        .contains("Direct chat: off"));
    let personalization_saved = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "personalization".to_string(),
                args: vec!["memory".to_string(), "off".to_string()],
            })
            .await
            .expect("personalization settings should save"),
    );
    assert_eq!(personalization_saved["message"], "Personalization saved");

    let subscription = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "subscription".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("subscription should load"),
    );
    assert!(subscription["message"]
        .as_str()
        .expect("message")
        .contains("Subscription status: active"));
    for (action, expected) in [
        ("cancel", "Subscription canceled"),
        ("reactivate", "Subscription reactivated"),
    ] {
        let result = result_value(
            runtime
                .remote_settings_command(RemoteSettingsCommandParams {
                    area: "subscription".to_string(),
                    args: vec![action.to_string()],
                })
                .await
                .expect("subscription action should save"),
        );
        assert_eq!(result["message"], expected);
    }
    let upgraded = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "subscription".to_string(),
                args: vec!["upgrade".to_string(), "team".to_string()],
            })
            .await
            .expect("subscription upgrade should save"),
    );
    assert_eq!(upgraded["message"], "Plan updated");

    let data_help = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "data".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("data help should render"),
    );
    assert!(data_help["message"]
        .as_str()
        .expect("message")
        .contains("Use /settings data export"));
    let mismatch = runtime
        .remote_settings_command(RemoteSettingsCommandParams {
            area: "data".to_string(),
            args: vec!["delete".to_string(), "wrong@example.com".to_string()],
        })
        .await
        .expect_err("email mismatch should fail");
    assert_eq!(mismatch.code, -32602);
    let deleted = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "data".to_string(),
                args: vec!["delete".to_string(), "ops@example.com".to_string()],
            })
            .await
            .expect("account delete should save"),
    );
    assert_eq!(deleted["message"], "Account deleted");
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should be restored for app settings");

    let apps = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("apps should list"),
    );
    assert!(apps["message"]
        .as_str()
        .expect("message")
        .contains("github"));
    let connect = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: vec!["connect".to_string(), "github".to_string()],
            })
            .await
            .expect("connect should render guidance"),
    );
    assert!(connect["message"]
        .as_str()
        .expect("message")
        .contains("/api/auth/signin/github"));
    let disconnected = result_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "apps".to_string(),
                args: vec!["disconnect".to_string(), "github".to_string()],
            })
            .await
            .expect("disconnect should save"),
    );
    assert_eq!(disconnected["message"], "Integration disconnected");

    server.join().expect("remote settings server should finish");
    let requests = requests.lock().expect("requests should be recorded");
    assert!(requests
        .iter()
        .any(|request| request.path == "/auth/settings"));
    assert!(requests
        .iter()
        .any(|request| request.path == "/gdpr/delete-account"));
}

#[tokio::test]
async fn command_execute_handles_status_and_help() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/status".to_string(),
            })
            .await
            .expect("status command should succeed"),
    );
    assert_eq!(status["handled"], true);
    assert_eq!(status["title"], "Status");

    let help = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/help".to_string(),
            })
            .await
            .expect("help command should succeed"),
    );
    assert!(help["message"]
        .as_str()
        .expect("message should be string")
        .contains("/search <query>"));
}

#[test]
fn mock_server_matches_developer_v1_api() {
    let calls = Arc::new(Mutex::new(BTreeMap::new()));

    let (_, root) = mock_response("GET", "/", &calls);
    assert!(root.contains("TaskForceAI Mock API"));

    let (_, created) = mock_response("POST", "/api/v1/developer/run", &calls);
    assert!(created.contains("\"status\":\"processing\""));
    let task_id = created
        .split("\"taskId\":\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("mock task id should be present")
        .to_string();

    let (_, processing) = mock_response(
        "GET",
        &format!("/api/v1/developer/status/{task_id}"),
        &calls,
    );
    assert!(processing.contains("Mock task processing"));

    let (_, completed) = mock_response(
        "GET",
        &format!("/api/v1/developer/status/{task_id}"),
        &calls,
    );
    assert!(completed.contains(MOCK_RESULT));

    let (_, result) = mock_response(
        "GET",
        &format!("/api/v1/developer/results/{task_id}"),
        &calls,
    );
    assert!(result.contains(MOCK_RESULT));
}

#[test]
fn parses_skill_and_plugin_metadata() {
    let dir = std::env::temp_dir().join(format!("taskforceai-metadata-{}", unix_millis()));
    fs::create_dir_all(&dir).expect("metadata dir should be created");

    let skill_dir = dir.join("ship-rust");
    fs::create_dir_all(&skill_dir).expect("skill dir should be created");
    let skill_path = skill_dir.join("SKILL.md");
    fs::write(
        &skill_path,
        "---\nname: ship-rust\ndescription: Use when shipping Rust app-server work.\n---\n",
    )
    .expect("skill should be written");

    let plugin_path = dir.join("plugin.json");
    fs::write(
        &plugin_path,
        r#"{"id":"taskforceai.dev","name":"TaskForceAI Dev","enabled":false}"#,
    )
    .expect("plugin should be written");

    let skill = parse_skill_file(&skill_path, "repo")
        .expect("skill should parse")
        .expect("skill should exist");
    assert_eq!(skill.name, "ship-rust");
    assert_eq!(skill.source, "repo");

    let plugin = parse_plugin_manifest(&plugin_path)
        .expect("plugin should parse")
        .expect("plugin should exist");
    assert_eq!(plugin.id, "taskforceai.dev");
    assert_eq!(plugin.name, "TaskForceAI Dev");
    assert!(!plugin.enabled);
    assert_eq!(plugin.source, None);

    let parsed_enabled =
        parse_plugin_enabled_config("[plugins.\"browser@openai-bundled\"]\nenabled = false\n");
    assert_eq!(parsed_enabled.get("browser@openai-bundled"), Some(&false));

    fs::remove_dir_all(dir).expect("metadata dir should be removed");
}

#[test]
fn plugin_set_enabled_persists_local_override() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    runtime
        .plugin_set_enabled(PluginSetEnabledParams {
            plugin_id: "browser@openai-bundled".to_string(),
            enabled: false,
        })
        .expect("plugin override should persist");

    let overrides = runtime
        .plugin_enabled_overrides()
        .expect("plugin overrides should load");
    assert_eq!(overrides.get("browser@openai-bundled"), Some(&false));
}
