use serde_json::{json, Value};

use crate::protocol::{
    AppResponse, AppServerEvent, GoalStatus, HybridModeSetParams, LocalSettingsUpdateParams,
    McpAuthSetParams, McpServerAddParams, McpServerParams, McpServerStatusDetail,
    McpServerStatusListParams, McpToolCallParams, OrchestrationBudgetSetParams,
    OrchestrationRoleSetParams, PetSetParams, ProjectIDParams, RemoteSettingsCommandParams,
};

use super::{AppRuntime, RuntimeConfig};

#[test]
fn settings_methods_cover_pet_orchestration_hybrid_and_local_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let not_configured = runtime
        .not_configured("offline feature")
        .expect_err("not configured helper should fail");
    assert_eq!(not_configured.message, "offline feature is not wired yet");
    let empty_goal = runtime
        .set_goal("   ")
        .expect_err("empty goal objective should fail");
    assert_eq!(empty_goal.message, "goal objective is required");
    assert!(runtime
        .update_goal_status(GoalStatus::Paused)
        .expect("missing goal update should not fail")
        .is_none());
    runtime
        .save_goal(&crate::protocol::GoalRecord {
            objective: "previous goal".to_string(),
            status: GoalStatus::Paused,
            created_at: 1,
            updated_at: 2,
        })
        .expect("old goal should store");
    let replacement = runtime
        .set_goal("replacement goal")
        .expect("replacement goal should set");
    assert_ne!(replacement.created_at, 1);
    assert_eq!(replacement.created_at, replacement.updated_at);

    let pet = response_value(
        runtime
            .pet_set(PetSetParams {
                name: Some(" Scout ".to_string()),
                mood: Some("ALERT".to_string()),
                visible: Some(false),
            })
            .expect("pet should update"),
    );
    assert_eq!(pet["pet"]["name"], "Scout");
    assert_eq!(pet["pet"]["mood"], "alert");
    assert_eq!(pet["pet"]["visible"], false);
    assert!(pet["pet"]["message"]
        .as_str()
        .expect("pet message")
        .contains("Scout"));

    let empty_model = runtime
        .orchestration_set_role(OrchestrationRoleSetParams {
            role: "researcher".to_string(),
            model_id: "   ".to_string(),
        })
        .expect_err("empty model should be rejected");
    assert_eq!(empty_model.code, -32602);

    let invalid_budget = runtime
        .orchestration_set_budget(OrchestrationBudgetSetParams { budget: -1.0 })
        .expect_err("negative budget should fail");
    assert_eq!(invalid_budget.message, "budget must be zero or greater");

    let cleared_budget = response_value(
        runtime
            .orchestration_set_budget(OrchestrationBudgetSetParams { budget: 0.0 })
            .expect("zero budget should clear"),
    );
    assert_eq!(cleared_budget["orchestration"]["budget"], Value::Null);

    let invalid_hybrid = runtime
        .hybrid_mode_set(HybridModeSetParams {
            enabled: true,
            model_id: Some("gpt-5".to_string()),
            role: Some("skeptic".to_string()),
        })
        .expect_err("hybrid mode should require local ollama model");
    assert!(invalid_hybrid.message.contains("ollama"));

    let settings = response_value(
        runtime
            .local_settings_update(LocalSettingsUpdateParams {
                telemetry_environment: Some("   ".to_string()),
                web_search_enabled: Some(false),
                code_execution_enabled: Some(false),
                trust_layer_enabled: Some(false),
                notifications_enabled: Some(false),
                ..Default::default()
            })
            .expect("settings should update"),
    );
    assert_eq!(settings["settings"]["telemetryEnvironment"], "cli");
    assert_eq!(settings["settings"]["webSearchEnabled"], false);
    assert_eq!(settings["settings"]["codeExecutionEnabled"], false);
    assert_eq!(settings["settings"]["trustLayerEnabled"], false);
    assert_eq!(settings["settings"]["notificationsEnabled"], false);
}

#[test]
fn settings_metadata_defaults_cover_empty_stored_values_and_context_optional_items() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    runtime
        .set_metadata_value("pet_state", "   ")
        .expect("pet metadata should store");
    assert_eq!(runtime.pet_state().expect("pet should load").name, "Pulse");

    runtime
        .set_metadata_value("orchestration_config", "   ")
        .expect("orchestration metadata should store");
    assert!(!runtime
        .orchestration_config()
        .expect("orchestration should load")
        .roles
        .is_empty());

    runtime
        .set_metadata_value("local_settings", "   ")
        .expect("local settings metadata should store");
    assert_eq!(
        runtime
            .local_settings()
            .expect("local settings should load")
            .theme,
        "system"
    );

    runtime
        .set_metadata_value("mcp_servers", "   ")
        .expect("mcp metadata should store");
    assert!(runtime
        .mcp_servers()
        .expect("mcp servers should load")
        .is_empty());

    runtime
        .set_metadata_value("plugin_enabled_overrides", "   ")
        .expect("plugin overrides should store");
    assert!(runtime
        .plugin_enabled_overrides()
        .expect("plugin overrides should load")
        .is_empty());

    runtime
        .goal_set(crate::protocol::GoalSetParams {
            objective: "cover context".to_string(),
        })
        .expect("goal should set");
    runtime
        .project_use(ProjectIDParams { project_id: 42 })
        .expect("project should set");
    let context = runtime.context_summary_result();
    assert!(context.items.iter().any(|item| item.category == "goal"));
    assert!(context.items.iter().any(|item| item.category == "project"));
}

#[tokio::test]
async fn settings_methods_cover_remote_wrappers_and_mcp_config_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let no_login = runtime
        .remote_settings_command(RemoteSettingsCommandParams {
            area: "unknown".to_string(),
            args: Vec::new(),
        })
        .await
        .expect_err("remote settings should require login first");
    assert_eq!(no_login.message, "login required for product settings");

    runtime
        .set_auth_token(Some("token"))
        .expect("auth token should store");
    let unknown_settings = response_value(
        runtime
            .remote_settings_command(RemoteSettingsCommandParams {
                area: "unknown".to_string(),
                args: Vec::new(),
            })
            .await
            .expect("unknown settings area should return usage"),
    );
    assert_eq!(unknown_settings["handled"], false);
    assert!(unknown_settings["message"]
        .as_str()
        .expect("usage message")
        .contains("/settings"));

    assert!(response_value(runtime.skill_list().expect("skills should list"))["skills"].is_array());
    assert!(
        response_value(runtime.plugin_list().expect("plugins should list"))["plugins"].is_array()
    );

    let added = response_value(
        runtime
            .mcp_add(McpServerAddParams {
                name: "files".to_string(),
                endpoint: "stdio:echo files".to_string(),
                tools: vec!["read".to_string()],
                enabled: true,
            })
            .expect("mcp server should add"),
    );
    assert_eq!(added["server"]["tools"][0], "read");

    let replaced = response_value(
        runtime
            .mcp_add(McpServerAddParams {
                name: "files".to_string(),
                endpoint: "stdio:echo replacement".to_string(),
                tools: vec!["write".to_string()],
                enabled: true,
            })
            .expect("mcp server should replace by name"),
    );
    assert_eq!(replaced["server"]["tools"][0], "write");

    let missing_remove = runtime
        .mcp_remove(McpServerParams {
            name: "missing".to_string(),
        })
        .expect_err("missing mcp remove should fail");
    assert_eq!(missing_remove.message, "mcp server not found");

    let unavailable_tool = runtime
        .mcp_call_tool(McpToolCallParams {
            name: "files".to_string(),
            tool: "read".to_string(),
            input: json!({}),
        })
        .await
        .expect_err("disabled tool should fail");
    assert_eq!(
        unavailable_tool.message,
        "mcp tool is not enabled for server"
    );

    let call = response_value(
        runtime
            .mcp_call_tool(McpToolCallParams {
                name: "files".to_string(),
                tool: "write".to_string(),
                input: json!({"path": "README.md"}),
            })
            .await
            .expect("enabled tool should return approval guidance"),
    );
    assert_eq!(call["serverName"], "files");
    assert_eq!(call["toolName"], "write");
    assert_eq!(call["adapterReady"], false);

    runtime
        .mcp_add(McpServerAddParams {
            name: "disabled".to_string(),
            endpoint: "stdio:echo disabled".to_string(),
            tools: Vec::new(),
            enabled: false,
        })
        .expect("disabled mcp server should add");
    let disabled_call = runtime
        .mcp_call_tool(McpToolCallParams {
            name: "disabled".to_string(),
            tool: "anything".to_string(),
            input: json!({}),
        })
        .await
        .expect_err("disabled server should fail tool calls");
    assert_eq!(disabled_call.message, "mcp server is disabled");

    let missing_call = runtime
        .mcp_call_tool(McpToolCallParams {
            name: "missing".to_string(),
            tool: "anything".to_string(),
            input: json!({}),
        })
        .await
        .expect_err("missing server should fail tool calls");
    assert_eq!(missing_call.message, "mcp server not found");

    let available = response_value(runtime.mcp_available().expect("mcp availability"));
    assert_eq!(available["adapterReady"], false);
    assert_eq!(available["servers"].as_array().expect("servers").len(), 1);

    let live_runtime = AppRuntime::new(RuntimeConfig {
        live_mcp_adapter: true,
        ..RuntimeConfig::default()
    });
    let live_available = response_value(live_runtime.mcp_available().expect("live availability"));
    assert_eq!(live_available["adapterReady"], true);
    assert!(live_available["message"]
        .as_str()
        .expect("live message")
        .contains("available"));

    let inspected = runtime
        .mcp_inspect_config_result(McpServerParams {
            name: "files".to_string(),
        })
        .expect("mcp inspect config should work");
    assert_eq!(inspected.transport, "stdio");
    assert_eq!(inspected.command.as_deref(), Some("echo"));

    let missing_inspect = runtime
        .mcp_inspect_config_result(McpServerParams {
            name: "missing".to_string(),
        })
        .expect_err("missing inspect should fail");
    assert_eq!(missing_inspect.message, "mcp server not found");

    let mut live_mcp = AppRuntime::new(RuntimeConfig {
        live_mcp_adapter: true,
        ..RuntimeConfig::default()
    });
    live_mcp
        .mcp_add(McpServerAddParams {
            name: "bad-stdio".to_string(),
            endpoint: "stdio:/definitely/not/a/taskforceai-command".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .expect("bad stdio server should add");
    let live_call = response_value(
        live_mcp
            .mcp_call_tool(McpToolCallParams {
                name: "bad-stdio".to_string(),
                tool: "write".to_string(),
                input: json!({"path": "/tmp/must-not-be-written"}),
            })
            .await
            .expect("live tool calls should return approval guidance without executing"),
    );
    assert_eq!(live_call["adapterReady"], false);
    assert_eq!(live_call["result"], Value::Null);
    assert_eq!(
        live_call["message"],
        "MCP tool execution requires explicit user approval."
    );
    let inspect_error = live_mcp
        .mcp_inspect_result(McpServerParams {
            name: "bad-stdio".to_string(),
        })
        .await
        .expect_err("bad stdio command should fail live inspect");
    assert_eq!(inspect_error.code, -32030);
}

#[tokio::test]
async fn mcp_credentials_report_status_and_emit_lifecycle_events() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .mcp_add(McpServerAddParams {
            name: "oauth-fixture".to_string(),
            endpoint: "https://mcp.example.test/rpc".to_string(),
            tools: Vec::new(),
            enabled: true,
        })
        .expect("MCP fixture should add");

    let configured = runtime
        .mcp_auth_set(McpAuthSetParams {
            name: "oauth-fixture".to_string(),
            access_token: "secret-token".to_string(),
        })
        .await
        .expect("MCP token should configure");
    let AppResponse::WithEvents { result, events } = configured else {
        panic!("MCP auth should emit status events");
    };
    assert_eq!(result["status"], "authenticated_configured");
    assert!(matches!(
        events.as_slice(),
        [AppServerEvent::McpStartupStatusUpdated { .. }]
    ));

    let reloaded = runtime
        .mcp_reload()
        .await
        .expect("MCP reload should succeed");
    let AppResponse::WithEvents { events, .. } = reloaded else {
        panic!("MCP reload should emit startup status events");
    };
    assert!(matches!(
        events.as_slice(),
        [AppServerEvent::McpStartupStatusUpdated { .. }]
    ));

    let status = response_value(
        runtime
            .mcp_oauth_status(McpServerParams {
                name: "oauth-fixture".to_string(),
            })
            .await
            .expect("OAuth status should load"),
    );
    assert_eq!(status["status"], "authenticated_configured");

    let cleared = runtime
        .mcp_auth_clear(McpServerParams {
            name: "oauth-fixture".to_string(),
        })
        .await
        .expect("MCP token should clear");
    assert_eq!(response_value(cleared)["status"], "configured");
    assert!(!runtime
        .mcp_manager
        .has_auth_token("https://mcp.example.test/rpc"));
}

#[tokio::test]
async fn mcp_server_status_list_is_stable_paged_and_resilient() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    for (name, enabled) in [("zeta", false), ("alpha", true)] {
        runtime
            .mcp_add(McpServerAddParams {
                name: name.to_string(),
                endpoint: format!("stdio:echo {name}"),
                tools: Vec::new(),
                enabled,
            })
            .expect("MCP server should add");
    }

    let first = response_value(
        runtime
            .mcp_server_status_list(McpServerStatusListParams {
                limit: Some(1),
                ..Default::default()
            })
            .await
            .expect("first MCP status page"),
    );
    assert_eq!(first["data"][0]["name"], "alpha");
    assert_eq!(first["data"][0]["connectionStatus"], "configured");
    assert_eq!(first["data"][0]["authStatus"], "unsupported");
    assert_eq!(first["data"][0]["tools"], json!({}));
    assert_eq!(first["nextCursor"], "1");

    let second = response_value(
        runtime
            .mcp_server_status_list(McpServerStatusListParams {
                cursor: Some("1".to_string()),
                detail: Some(McpServerStatusDetail::ToolsAndAuthOnly),
                ..Default::default()
            })
            .await
            .expect("second MCP status page"),
    );
    assert_eq!(second["data"][0]["name"], "zeta");
    assert_eq!(second["data"][0]["connectionStatus"], "disabled");
    assert!(second.get("nextCursor").is_none());

    let invalid = runtime
        .mcp_server_status_list(McpServerStatusListParams {
            cursor: Some("not-a-cursor".to_string()),
            ..Default::default()
        })
        .await
        .expect_err("invalid MCP status cursor should fail");
    assert_eq!(invalid.code, -32602);
}

fn response_value(response: AppResponse) -> Value {
    match response {
        AppResponse::Value(value) | AppResponse::Shutdown(value) => value,
        AppResponse::WithEvents { result, .. } => result,
    }
}
