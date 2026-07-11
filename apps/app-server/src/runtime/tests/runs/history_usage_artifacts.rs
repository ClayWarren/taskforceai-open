use super::*;

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
async fn apply_event_preserves_canceled_runs_and_deletes_existing_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("apply event"))
        .await
        .expect("submit should succeed");
    runtime
        .run_cancel(RunIDParams {
            run_id: "local_run_1".to_string(),
        })
        .expect("cancel should succeed");

    let mut stale = runtime
        .get_run("local_run_1")
        .expect("run should exist after cancel");
    stale.status = RunStatus::Processing;
    stale.output = Some("late output".to_string());
    let events = runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(stale),
        })
        .expect("late event should be handled");
    assert_eq!(events.len(), 1);
    match &events[0] {
        AppServerEvent::RunUpdated { run } => assert_eq!(run.status, RunStatus::Canceled),
        other => panic!("unexpected event: {other:?}"),
    }
    assert_eq!(
        runtime
            .get_run("local_run_1")
            .expect("run should remain")
            .status,
        RunStatus::Canceled
    );

    runtime
        .apply_event(AppServerEvent::RunDeleted {
            run_id: "local_run_1".to_string(),
        })
        .expect("delete event should be handled");
    assert!(runtime.get_run("local_run_1").is_err());

    let unknown = AppServerEvent::RunUpdated {
        run: Box::new(RunRecord {
            id: "missing_run".to_string(),
            prompt: "missing".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: Some("ignored".to_string()),
            error: None,
            created_at: 1,
            updated_at: 2,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }),
    };
    let events = runtime
        .apply_event(unknown)
        .expect("unknown run update should be retained as event");
    assert_eq!(events.len(), 1);
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
    runtime.runs.insert(
        "failed_run".to_string(),
        RunRecord {
            id: "failed_run".to_string(),
            prompt: "failed".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Failed,
            output: None,
            error: Some("boom".to_string()),
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );
    runtime.runs.insert(
        "processing_run".to_string(),
        RunRecord {
            id: "processing_run".to_string(),
            prompt: "processing".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Processing,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );

    let usage = result_value(runtime.usage_summary());
    assert_eq!(usage["totalRuns"], 4);
    assert_eq!(usage["queuedRuns"], 1);
    assert_eq!(usage["canceledRuns"], 1);
    assert_eq!(usage["failedRuns"], 1);
    assert_eq!(usage["processingRuns"], 1);
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

#[tokio::test]
async fn artifacts_command_requires_login() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifacts");
    assert_eq!(result["handled"], false);
    assert!(result["message"]
        .as_str()
        .expect("message should be string")
        .contains("Login required"));

    for input in [
        "/artifacts show artifact-1",
        "/artifacts share artifact-1",
        "/artifacts delete artifact-1",
        "/artifacts download artifact-1",
    ] {
        let result = result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: input.to_string(),
                })
                .await
                .expect("command should return login guidance"),
        );
        assert_eq!(result["title"], "Artifacts");
        assert_eq!(result["handled"], false);
        assert!(result["message"]
            .as_str()
            .expect("message should be string")
            .contains("Login required"));
    }
}

#[tokio::test]
async fn artifacts_command_rejects_unknown_action_and_missing_ids() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let unknown = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts wat".to_string(),
            })
            .await
            .expect("unknown artifacts command should return usage"),
    );
    assert_eq!(unknown["title"], "Artifacts");
    assert_eq!(unknown["handled"], false);
    assert!(unknown["message"]
        .as_str()
        .expect("message should be string")
        .contains("Usage: /artifacts"));

    for input in [
        "/artifacts show",
        "/artifacts share",
        "/artifacts delete",
        "/artifacts download",
    ] {
        let error = runtime
            .command_execute(CommandExecuteParams {
                input: input.to_string(),
            })
            .await
            .expect_err("missing artifact id should be invalid");
        assert!(error.to_string().contains("artifact id is required"));
    }
}

#[tokio::test]
async fn artifacts_command_lists_authenticated_recent_artifacts() {
    let (base_url, server, requests) =
        start_recording_response_sequence_server(vec![json_response(
            json!([
                {
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PRIVATE",
                    "updatedAt": "2026-06-14T20:00:00Z",
                    "currentVersion": {
                        "id": "version-1",
                        "filename": "launch-memo.pdf",
                        "mimeType": "application/pdf",
                        "sizeBytes": 2048
                    }
                },
                {
                    "id": "artifact-2",
                    "title": "Revenue chart",
                    "type": "CHART",
                    "status": "READY",
                    "visibility": "PUBLIC_LINK"
                }
            ])
            .to_string(),
        )]);
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
                input: "/artifacts list".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifacts");
    assert_eq!(result["handled"], true);
    let message = result["message"]
        .as_str()
        .expect("message should be string");
    assert!(message.contains("Recent artifacts: 2 shown"));
    assert!(message.contains("launch-memo.pdf [DOCUMENT · READY · PRIVATE]"));
    assert!(message.contains("application/pdf, 2.0 KB, version version-1"));
    assert!(message.contains("/artifacts/artifact-1"));
    assert!(message.contains("Revenue chart [CHART · READY · PUBLIC_LINK]"));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].method, "GET");
    assert_eq!(
        recorded[0].path,
        "/artifacts?limit=10&offset=0&include=currentVersion"
    );
    assert_eq!(
        recorded[0].headers.get("authorization").map(String::as_str),
        Some("Bearer token")
    );
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_shows_detail_and_versions() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersionId": "version-2",
                "createdAt": "2026-06-13T20:00:00Z",
                "updatedAt": "2026-06-14T20:00:00Z"
            })
            .to_string(),
        ),
        json_response(
            json!([
                {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "version": 2,
                    "fileId": "file-2",
                    "filename": "launch-memo.pdf",
                    "mimeType": "application/pdf",
                    "bytes": 2048,
                    "createdAt": "2026-06-14T20:00:00Z"
                }
            ])
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
                input: "/artifacts show artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact");
    assert_eq!(result["handled"], true);
    let message = result["message"].as_str().expect("message");
    assert!(message.contains("title: Launch memo"));
    assert!(message.contains("path: /artifacts/artifact-1"));
    assert!(message.contains(
        "- v2 launch-memo.pdf [application/pdf] artifact=artifact-1 file=file-2 size=2048"
    ));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/versions");
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_creates_public_link() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "token": "public-token",
                "url": "https://taskforceai.chat/artifacts/public/public-token",
                "artifact": {
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PUBLIC_LINK"
                }
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
                input: "/artifacts share artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Link");
    assert_eq!(result["handled"], true);
    assert!(result["message"]
        .as_str()
        .expect("message")
        .contains("https://taskforceai.chat/artifacts/public/public-token"));

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/api/auth/csrf");
    assert_eq!(recorded[1].method, "POST");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/share/public");
    assert_eq!(
        recorded[1].headers.get("x-csrf-token").map(String::as_str),
        Some("test-csrf")
    );
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_deletes_artifact() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(json!({ "success": true }).to_string()),
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
                input: "/artifacts delete artifact-1".to_string(),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Deleted");
    assert_eq!(result["handled"], true);
    assert_eq!(result["message"], "Deleted artifact artifact-1.");

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[1].method, "DELETE");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1");
    drop(recorded);
    server.join().expect("mock server should finish");
}

#[tokio::test]
async fn artifacts_command_downloads_current_file_without_overwriting() {
    let output_path = test_store_path("artifact-download").with_extension("txt");
    let _ = fs::remove_file(&output_path);
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersion": {
                    "id": "version-1",
                    "artifactId": "artifact-1",
                    "version": 1,
                    "fileId": "file-1",
                    "filename": "launch-memo.txt",
                    "mimeType": "text/plain",
                    "bytes": 11
                }
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: "hello bytes".to_string(),
            headers: Vec::new(),
        },
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
                input: format!("/artifacts download artifact-1 {}", output_path.display()),
            })
            .await
            .expect("command should succeed"),
    );

    assert_eq!(result["title"], "Artifact Downloaded");
    assert_eq!(result["handled"], true);
    assert_eq!(
        fs::read_to_string(&output_path).expect("artifact should write"),
        "hello bytes"
    );

    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(
        recorded[1].path,
        "/developer/files/file-1/content?disposition=attachment"
    );
    drop(recorded);
    server.join().expect("mock server should finish");
    let _ = fs::remove_file(output_path);
}

#[tokio::test]
async fn artifacts_command_downloads_selected_version_when_current_is_missing() {
    let output_path = test_store_path("artifact-download-fallback").with_extension("txt");
    let _ = fs::remove_file(&output_path);
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!({
                "id": "artifact-1",
                "title": "Launch memo",
                "type": "DOCUMENT",
                "status": "READY",
                "visibility": "PRIVATE",
                "currentVersionId": "version-2"
            })
            .to_string(),
        ),
        json_response(
            json!([
                {
                    "id": "version-1",
                    "artifactId": "artifact-1",
                    "version": 1,
                    "fileId": "file-1",
                    "filename": "old.txt"
                },
                {
                    "id": "version-2",
                    "artifactId": "artifact-1",
                    "version": 2,
                    "fileId": "file-2",
                    "filename": "selected.txt"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: "selected bytes".to_string(),
            headers: Vec::new(),
        },
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
                input: format!("/artifacts download artifact-1 {}", output_path.display()),
            })
            .await
            .expect("fallback version download should succeed"),
    );

    assert_eq!(result["title"], "Artifact Downloaded");
    assert_eq!(
        fs::read_to_string(&output_path).expect("artifact should write"),
        "selected bytes"
    );
    let recorded = requests.lock().expect("requests lock should not poison");
    assert_eq!(recorded[0].path, "/artifacts/artifact-1");
    assert_eq!(recorded[1].path, "/artifacts/artifact-1/versions");
    assert_eq!(
        recorded[2].path,
        "/developer/files/file-2/content?disposition=attachment"
    );
    drop(recorded);
    server.join().expect("mock server should finish");
    let _ = fs::remove_file(output_path);
}

#[tokio::test]
async fn artifacts_command_reports_missing_downloadable_versions() {
    for (responses, expected) in [
        (
            vec![json_response(
                json!({
                    "id": "artifact-1",
                    "title": "Launch memo",
                    "type": "DOCUMENT",
                    "status": "READY",
                    "visibility": "PRIVATE",
                    "currentVersion": {
                        "id": "version-1",
                        "artifactId": "artifact-1",
                        "version": 1,
                        "filename": "launch-memo.txt"
                    }
                })
                .to_string(),
            )],
            "no downloadable file version",
        ),
        (
            vec![
                json_response(
                    json!({
                        "id": "artifact-1",
                        "title": "Launch memo",
                        "type": "DOCUMENT",
                        "status": "READY",
                        "visibility": "PRIVATE"
                    })
                    .to_string(),
                ),
                json_response(json!([]).to_string()),
            ],
            "no versions available",
        ),
    ] {
        let (base_url, server, _requests) = start_recording_response_sequence_server(responses);
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

        let response = runtime
            .command_execute(CommandExecuteParams {
                input: "/artifacts download artifact-1".to_string(),
            })
            .await;
        match response {
            Ok(response) => {
                let result = result_value(response);
                assert!(result["message"]
                    .as_str()
                    .expect("message should be string")
                    .contains(expected));
            }
            Err(error) => assert!(error.to_string().contains(expected)),
        }
        server.join().expect("mock server should finish");
    }
}
