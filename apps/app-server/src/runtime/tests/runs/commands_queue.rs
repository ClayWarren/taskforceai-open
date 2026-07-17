use super::*;

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
    set_auth_token(&mut upload_runtime, "token");
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
