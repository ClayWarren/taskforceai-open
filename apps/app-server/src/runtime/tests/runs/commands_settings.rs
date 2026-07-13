use super::*;

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
