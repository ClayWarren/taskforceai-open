use super::*;
use crate::api::{ApiCreateProjectRequest, ApiSyncPullRequest, ApiSyncPushRequest};

#[tokio::test]
async fn api_client_error_paths_report_status_and_csrf_failures() {
    expect_error(
        vec![status_response(503, "csrf unavailable")],
        |client| async move { client.start_device_login().await },
        "503",
    )
    .await;
    expect_error(
        vec![response("{}")],
        |client| async move { client.start_device_login().await },
        "csrf",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(429, "rate limited")],
        |client| async move { client.start_device_login().await },
        "429",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(401, "unauthorized")],
        |client| async move { client.poll_device_login("device").await },
        "401",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(409, "conflict")],
        |client| async move {
            client
                .submit_run(
                    "token",
                    ApiSubmitRunRequest {
                        prompt: "run".to_string(),
                        model_id: None,
                        reasoning_effort: None,
                        quick_mode: false,
                        autonomous: false,
                        computer_use: false,
                        computer_use_target: None,
                        use_logged_in_services: false,
                        agent_count: None,
                        project_id: None,
                        attachment_ids: Vec::new(),
                        role_models: BTreeMap::new(),
                        budget: None,
                        mcp_servers: Vec::new(),
                        client_mcp_tools: Vec::new(),
                        private_chat: false,
                        research_workflow: None,
                    },
                )
                .await
        },
        "409",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(413, "too large")],
        |client| async move {
            client
                .upload_attachment("token", "large.bin", vec![1, 2, 3])
                .await
        },
        "413",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(404, "missing")],
        |client| async move { client.cancel_run("token", "task").await },
        "404",
    )
    .await;
    expect_error(
        vec![status_response(502, "model list down")],
        |client| async move { client.list_models().await },
        "502",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(500, "sync pull failed")],
        |client| async move {
            client
                .sync_pull(
                    "token",
                    ApiSyncPullRequest {
                        device_id: "device".to_string(),
                        last_sync_version: 0,
                        limit: None,
                    },
                )
                .await
        },
        "500",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(500, "sync push failed")],
        |client| async move {
            client
                .sync_push(
                    "token",
                    ApiSyncPushRequest {
                        conversations: Vec::new(),
                        messages: Vec::new(),
                        deletions: Vec::new(),
                        device_id: "device".to_string(),
                    },
                )
                .await
        },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "poll failed")],
        |client| async move { client.sync_realtime_poll("token", None).await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "project list failed")],
        |client| async move { client.list_projects("token").await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "artifact list failed")],
        |client| async move { client.list_artifacts("token", 5).await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "artifact failed")],
        |client| async move { client.get_artifact("token", "artifact").await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "versions failed")],
        |client| async move { client.list_artifact_versions("token", "artifact").await },
        "500",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(500, "share failed")],
        |client| async move {
            client
                .create_artifact_public_link("token", "artifact")
                .await
        },
        "500",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(500, "delete failed")],
        |client| async move { client.delete_artifact("token", "artifact").await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "download failed")],
        |client| async move { client.download_file_content("token", "file").await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "user failed")],
        |client| async move { client.current_user("token").await },
        "500",
    )
    .await;
    expect_error(
        vec![csrf_response(), status_response(500, "settings failed")],
        |client| async move { client.update_settings("token", json!({})).await },
        "500",
    )
    .await;
    expect_error(
        vec![status_response(500, "export failed")],
        |client| async move { client.export_gdpr_data("token").await },
        "500",
    )
    .await;
    expect_error(
        vec![
            csrf_response(),
            status_response(500, "create project failed"),
        ],
        |client| async move {
            client
                .create_project(
                    "token",
                    ApiCreateProjectRequest {
                        name: "Project".to_string(),
                        description: None,
                        custom_instructions: None,
                    },
                )
                .await
        },
        "500",
    )
    .await;
    expect_error(
        vec![
            csrf_response(),
            status_response(500, "delete project failed"),
        ],
        |client| async move { client.delete_project("token", 1).await },
        "500",
    )
    .await;
}
