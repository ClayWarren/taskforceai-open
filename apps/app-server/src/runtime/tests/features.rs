use super::support::{
    json_response, result_value, set_auth_token, start_recording_response_sequence_server,
    test_store_path, MockHttpResponse,
};
use super::*;
use taskforceai_app_protocol::InitializeParams;

#[test]
fn initialize_advertises_tui_ready_capabilities() {
    let runtime = AppRuntime::new(RuntimeConfig::default());
    let result = result_value(runtime.initialize(InitializeParams::default()));

    assert_eq!(result["capabilities"]["runs"], true);
    assert_eq!(result["capabilities"]["history"], true);
    assert_eq!(result["capabilities"]["attachments"], true);
    assert_eq!(result["capabilities"]["events"], true);
    assert_eq!(result["capabilities"]["agentSessions"], true);
    assert_eq!(result["capabilities"]["diagnostics"], true);
    assert_eq!(result["capabilities"]["channels"], true);
    assert_eq!(result["capabilities"]["schedules"], true);
    assert_eq!(result["capabilities"]["workflows"], true);

    let negotiated = result_value(runtime.initialize(InitializeParams {
        capabilities: taskforceai_app_protocol::ClientCapabilities {
            experimental_api: true,
            bidirectional_requests: true,
            request_user_input: true,
            mcp_elicitation: true,
            dynamic_tools: true,
            opt_out_notification_methods: Vec::new(),
        },
        ..InitializeParams::default()
    }));
    assert_eq!(negotiated["negotiated"]["dynamicTools"], true);
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

    set_auth_token(&mut runtime, "token");
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
    set_auth_token(&mut runtime, "token");

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
fn skill_roots_enablement_and_watch_revision_round_trip() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-skill-root-{}",
        crate::runtime::util::unix_millis()
    ));
    let skill_dir = root.join("protocol-audit");
    std::fs::create_dir_all(&skill_dir).expect("skill directory should create");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: protocol-audit\ndescription: Audit protocol compatibility\n---\n",
    )
    .expect("skill should write");

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let listed = result_value(
        runtime
            .skill_roots_set(SkillRootsSetParams {
                roots: vec![root.to_string_lossy().to_string()],
            })
            .expect("skill root should configure"),
    );
    let skill = listed["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .find(|skill| skill["name"] == "protocol-audit")
        .expect("configured skill should be discovered");
    let path = skill["path"].as_str().expect("skill path").to_string();
    assert_eq!(skill["enabled"], true);

    let first = result_value(
        runtime
            .skill_watch(SkillWatchParams::default())
            .expect("skill watch should work"),
    );
    let revision = first["revision"].as_str().expect("revision").to_string();
    assert_eq!(first["changed"], true);
    let unchanged = result_value(
        runtime
            .skill_watch(SkillWatchParams {
                previous_revision: Some(revision),
            })
            .expect("unchanged skill watch should work"),
    );
    assert_eq!(unchanged["changed"], false);

    let disabled = result_value(
        runtime
            .skill_set_enabled(SkillSetEnabledParams {
                path,
                enabled: false,
            })
            .expect("skill should disable"),
    );
    assert!(disabled["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .any(|skill| skill["name"] == "protocol-audit" && skill["enabled"] == false));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn skill_configuration_rejects_invalid_paths_and_roots() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    assert!(runtime
        .skill_set_enabled(SkillSetEnabledParams {
            path: "   ".to_string(),
            enabled: true,
        })
        .is_err());
    assert!(runtime
        .skill_set_enabled(SkillSetEnabledParams {
            path: "/definitely/missing/SKILL.md".to_string(),
            enabled: true,
        })
        .is_err());
    assert!(runtime
        .skill_roots_set(SkillRootsSetParams {
            roots: (0..33).map(|index| format!("/tmp/root-{index}")).collect(),
        })
        .is_err());
    assert!(runtime
        .skill_roots_set(SkillRootsSetParams {
            roots: vec!["relative/root".to_string()],
        })
        .is_err());
}

#[tokio::test]
async fn mcp_resource_and_auth_methods_validate_transport_and_credentials() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .mcp_add(McpServerAddParams {
            name: "http".to_string(),
            endpoint: "https://example.com/mcp".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .expect("add http server");
    runtime
        .mcp_add(McpServerAddParams {
            name: "stdio".to_string(),
            endpoint: "stdio://fixture?arg=serve".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .expect("add stdio server");
    runtime
        .mcp_add(McpServerAddParams {
            name: "disabled".to_string(),
            endpoint: "https://example.com/disabled".to_string(),
            tools: Vec::new(),
            enabled: false,
        })
        .expect("add disabled server");

    for params in [
        McpResourceReadParams {
            name: "http".to_string(),
            uri: " ".to_string(),
        },
        McpResourceReadParams {
            name: "missing".to_string(),
            uri: "file:///missing".to_string(),
        },
        McpResourceReadParams {
            name: "disabled".to_string(),
            uri: "file:///disabled".to_string(),
        },
        McpResourceReadParams {
            name: "http".to_string(),
            uri: "file:///configured-only".to_string(),
        },
        McpResourceReadParams {
            name: "stdio".to_string(),
            uri: "file:///configured-only".to_string(),
        },
    ] {
        assert!(runtime.mcp_resource_read(params).await.is_err());
    }

    assert!(runtime
        .mcp_auth_set(McpAuthSetParams {
            name: "http".to_string(),
            access_token: "  ".to_string(),
        })
        .await
        .is_err());
    assert!(runtime
        .mcp_auth_set(McpAuthSetParams {
            name: "stdio".to_string(),
            access_token: "token".to_string(),
        })
        .await
        .is_err());
    let authenticated = result_value(
        runtime
            .mcp_auth_set(McpAuthSetParams {
                name: "http".to_string(),
                access_token: " token ".to_string(),
            })
            .await
            .expect("set HTTP auth"),
    );
    assert_eq!(authenticated["status"], "authenticated_configured");
    let cleared = result_value(
        runtime
            .mcp_auth_clear(McpServerParams {
                name: "http".to_string(),
            })
            .await
            .expect("clear HTTP auth"),
    );
    assert_eq!(cleared["status"], "configured");
}

#[tokio::test]
async fn live_mcp_inspect_surfaces_adapter_connection_failures() {
    let mut runtime = AppRuntime::new(RuntimeConfig {
        live_mcp_adapter: true,
        ..RuntimeConfig::default()
    });
    runtime
        .mcp_add(McpServerAddParams {
            name: "unreachable".to_string(),
            endpoint: "http://127.0.0.1:9/mcp".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .expect("add unreachable server");
    assert!(runtime
        .mcp_inspect(McpServerParams {
            name: "unreachable".to_string(),
        })
        .await
        .is_err());
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
    set_auth_token(&mut runtime, "token");

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
    set_auth_token(&mut runtime, "token");

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
