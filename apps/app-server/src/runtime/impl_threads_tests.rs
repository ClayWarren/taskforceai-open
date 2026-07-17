use super::*;
use crate::runtime::{AppRuntime, RuntimeConfig};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn project_api(responses: Vec<String>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("project API should bind");
    let address = listener.local_addr().expect("project API address");
    let server = thread::spawn(move || {
        for body in responses {
            let (mut stream, _) = listener.accept().expect("project request should arrive");
            let mut request = [0_u8; 2048];
            let request_size = stream
                .read(&mut request)
                .expect("project request should read");
            assert!(request_size > 0, "project request should not be empty");
            let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
            stream
                .write_all(response.as_bytes())
                .expect("project response should write");
        }
    });
    (format!("http://{address}"), server)
}

fn item(id: &str, item_type: ThreadItemType, status: ThreadItemStatus) -> ThreadItemRecord {
    ThreadItemRecord {
        id: id.to_string(),
        turn_id: "turn-1".to_string(),
        item_type,
        status,
        content: json!({"text": id}),
        created_at: 1,
        updated_at: 1,
    }
}

fn imported_thread(state: ThreadState) -> ThreadRecord {
    ThreadRecord {
        id: "imported".to_string(),
        title: "Imported".to_string(),
        objective: "Continue imported work".to_string(),
        state,
        archived: false,
        source: "handoff".to_string(),
        task_mode: TaskMode::Work,
        parent_thread_id: Some("parent".to_string()),
        turns: vec![
            TurnRecord {
                id: "turn-1".to_string(),
                thread_id: "imported".to_string(),
                run_id: "run-1".to_string(),
                status: TurnStatus::InProgress,
                items: vec![
                    item(
                        "latest message",
                        ThreadItemType::AgentMessage,
                        ThreadItemStatus::InProgress,
                    ),
                    item("boom", ThreadItemType::Error, ThreadItemStatus::Completed),
                ],
                created_at: 1,
                updated_at: 1,
            },
            TurnRecord {
                id: "turn-2".to_string(),
                thread_id: "imported".to_string(),
                run_id: "run-1".to_string(),
                status: TurnStatus::Queued,
                items: vec![item(
                    "final text",
                    ThreadItemType::AgentMessage,
                    ThreadItemStatus::Completed,
                )],
                created_at: 2,
                updated_at: 2,
            },
        ],
        created_at: 1,
        updated_at: 2,
    }
}

fn response_json(response: AppResponse) -> serde_json::Value {
    match response {
        AppResponse::Value(value) | AppResponse::Shutdown(value) => value,
        AppResponse::WithEvents { result, .. } => result,
    }
}

#[test]
fn thread_listing_and_paging_cover_memory_and_durable_stores() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let mut first = imported_thread(ThreadState::Active);
    first.id = "thread-1".to_string();
    first.updated_at = 1;
    let mut second = imported_thread(ThreadState::Paused);
    second.id = "thread-2".to_string();
    second.updated_at = 2;
    second.archived = true;
    runtime
        .thread_import(ThreadImportParams {
            thread: first,
            overwrite: false,
        })
        .expect("import first thread");
    runtime
        .thread_import(ThreadImportParams {
            thread: second,
            overwrite: false,
        })
        .expect("import second thread");

    let page = response_json(
        runtime
            .thread_list(ThreadListParams {
                cursor: Some("0".to_string()),
                limit: Some(1),
                include_turns: Some(false),
                archived: None,
                ..ThreadListParams::default()
            })
            .expect("list first page"),
    );
    assert_eq!(page["threads"][0]["id"], "thread-2");
    assert_eq!(page["threads"][0]["turns"], json!([]));
    assert_eq!(page["nextCursor"], "1");
    let archived = response_json(
        runtime
            .thread_list(ThreadListParams {
                cursor: None,
                limit: None,
                include_turns: None,
                archived: Some(true),
                ..ThreadListParams::default()
            })
            .expect("list archived threads"),
    );
    assert_eq!(archived["threads"].as_array().unwrap().len(), 1);
    assert!(runtime
        .thread_list(ThreadListParams {
            cursor: Some("invalid".to_string()),
            limit: None,
            include_turns: None,
            archived: None,
            ..ThreadListParams::default()
        })
        .is_err());

    let turns = response_json(
        runtime
            .thread_turns_list(ThreadTurnsListParams {
                thread_id: "thread-1".to_string(),
                cursor: Some("0".to_string()),
                limit: Some(1),
                include_items: Some(false),
            })
            .expect("list memory turns"),
    );
    assert_eq!(turns["turns"][0]["items"], json!([]));
    let items = response_json(
        runtime
            .thread_items_list(ThreadItemsListParams {
                thread_id: "thread-1".to_string(),
                turn_id: Some("turn-1".to_string()),
                cursor: None,
                limit: Some(1),
            })
            .expect("list memory items"),
    );
    assert_eq!(items["items"].as_array().unwrap().len(), 1);

    let store_path = std::env::temp_dir().join(format!(
        "taskforceai-thread-listing-{}-{}.sqlite",
        std::process::id(),
        unix_millis()
    ));
    let mut durable =
        AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store_path))
            .expect("durable runtime");
    durable
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Active),
            overwrite: false,
        })
        .expect("import durable thread");
    assert!(response_json(
        durable
            .thread_list(ThreadListParams {
                cursor: None,
                limit: Some(1),
                include_turns: Some(false),
                archived: Some(false),
                ..ThreadListParams::default()
            })
            .expect("list durable threads")
    )["threads"]
        .is_array());
    assert!(durable
        .thread_turns_list(ThreadTurnsListParams {
            thread_id: "missing".to_string(),
            cursor: None,
            limit: None,
            include_items: None,
        })
        .is_err());
    assert!(durable
        .thread_items_list(ThreadItemsListParams {
            thread_id: "missing".to_string(),
            turn_id: None,
            cursor: None,
            limit: None,
        })
        .is_err());
    assert!(response_json(
        durable
            .thread_turns_list(ThreadTurnsListParams {
                thread_id: "imported".to_string(),
                cursor: None,
                limit: Some(1),
                include_items: Some(false),
            })
            .expect("list durable turns")
    )["turns"]
        .is_array());
    assert!(response_json(
        durable
            .thread_items_list(ThreadItemsListParams {
                thread_id: "imported".to_string(),
                turn_id: None,
                cursor: None,
                limit: Some(1),
            })
            .expect("list durable items")
    )["items"]
        .is_array());
    durable
        .thread_delete(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("delete durable thread");
    std::fs::remove_file(store_path).ok();

    let migration_path = std::env::temp_dir().join(format!(
        "taskforceai-thread-migration-{}-{}.sqlite",
        std::process::id(),
        unix_millis()
    ));
    let mut migrating =
        AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&migration_path))
            .expect("migration runtime");
    migrating
        .set_metadata_json(
            crate::runtime::THREADS_METADATA_KEY,
            &vec![imported_thread(ThreadState::Paused)],
        )
        .expect("store legacy thread metadata");
    assert_eq!(
        migrating.thread_records().expect("migrate threads").len(),
        1
    );
    std::fs::remove_file(migration_path).ok();
}

#[test]
fn thread_import_validates_normalizes_and_overwrites_durable_state() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    for mutation in ["id", "title", "objective"] {
        let mut thread = imported_thread(ThreadState::Active);
        match mutation {
            "id" => thread.id = " ".to_string(),
            "title" => thread.title = " ".to_string(),
            _ => thread.objective = " ".to_string(),
        }
        assert!(runtime
            .thread_import(ThreadImportParams {
                thread,
                overwrite: false,
            })
            .is_err());
    }

    runtime
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Paused),
            overwrite: false,
        })
        .expect("import paused thread");
    let imported = runtime
        .find_thread_record("imported")
        .expect("imported thread");
    assert!(imported
        .turns
        .iter()
        .all(|turn| turn.status == TurnStatus::Interrupted));
    assert_eq!(imported.turns[0].items[0].status, ThreadItemStatus::Failed);
    let session = runtime
        .find_agent_session("imported")
        .expect("imported session");
    assert_eq!(session.state, "paused");
    assert_eq!(session.last_message.as_deref(), Some("final text"));
    assert_eq!(session.last_error.as_deref(), Some("boom"));
    assert_eq!(session.run_ids, vec!["run-1"]);
    assert!(runtime
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Active),
            overwrite: false,
        })
        .is_err());

    runtime
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Canceled),
            overwrite: true,
        })
        .expect("overwrite imported thread");
    assert_eq!(
        runtime
            .find_agent_session("imported")
            .expect("overwritten session")
            .state,
        "cancelled"
    );
}

#[test]
fn thread_metadata_state_rollback_and_delete_cover_validation_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Paused),
            overwrite: false,
        })
        .expect("import fixture");

    assert!(runtime
        .thread_name_set(ThreadNameSetParams {
            thread_id: "imported".to_string(),
            title: " ".to_string(),
        })
        .is_err());
    assert!(runtime
        .thread_metadata_update(ThreadMetadataUpdateParams {
            thread_id: "imported".to_string(),
            title: Some(" ".to_string()),
            objective: None,
        })
        .is_err());
    runtime
        .thread_name_set(ThreadNameSetParams {
            thread_id: "imported".to_string(),
            title: " Renamed ".to_string(),
        })
        .expect("rename thread");
    runtime
        .thread_metadata_update(ThreadMetadataUpdateParams {
            thread_id: "imported".to_string(),
            title: Some(" Metadata title ".to_string()),
            objective: Some(" Updated objective ".to_string()),
        })
        .expect("update objective");
    runtime
        .thread_resume(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("resume thread");
    runtime
        .thread_archive(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("archive thread");
    runtime
        .thread_unarchive(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("unarchive thread");
    assert!(runtime
        .thread_rollback(ThreadRollbackParams {
            thread_id: "imported".to_string(),
            turn_id: "missing".to_string(),
        })
        .is_err());
    runtime
        .thread_rollback(ThreadRollbackParams {
            thread_id: "imported".to_string(),
            turn_id: "turn-1".to_string(),
        })
        .expect("rollback thread");
    assert_eq!(
        runtime
            .find_thread_record("imported")
            .expect("rolled back thread")
            .turns
            .len(),
        1
    );
    assert!(runtime
        .thread_delete(ThreadIDParams {
            thread_id: "missing".to_string(),
        })
        .is_err());
    runtime
        .thread_delete(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("delete thread");
}

#[test]
fn thread_helpers_cover_collisions_text_lookup_and_all_run_states() {
    let base = ThreadRecord {
        id: "thread-10".to_string(),
        ..imported_thread(ThreadState::Active)
    };
    let second = ThreadRecord {
        id: "thread-10-2".to_string(),
        ..imported_thread(ThreadState::Active)
    };
    assert_eq!(unique_thread_id(&[], 10), "thread-10");
    assert_eq!(unique_thread_id(&[base, second], 10), "thread-10-3");
    assert_eq!(
        last_text_item(&[
            item(
                "first",
                ThreadItemType::AgentMessage,
                ThreadItemStatus::Completed
            ),
            item(
                "last",
                ThreadItemType::AgentMessage,
                ThreadItemStatus::Completed
            ),
        ])
        .as_deref(),
        Some("last")
    );
    for (status, expected) in [
        (RunStatus::Queued, TurnStatus::Queued),
        (RunStatus::Processing, TurnStatus::InProgress),
        (RunStatus::Completed, TurnStatus::Completed),
        (RunStatus::Failed, TurnStatus::Failed),
        (RunStatus::Canceled, TurnStatus::Interrupted),
    ] {
        assert_eq!(turn_status_for_run(&status), expected);
    }
}

fn turn_start_params(thread_id: &str, input: &str) -> TurnStartParams {
    TurnStartParams {
        thread_id: thread_id.to_string(),
        input: input.to_string(),
        display_input: None,
        model_id: None,
        reasoning_effort: None,
        quick_mode: None,
        autonomous: None,
        computer_use: None,
        use_logged_in_services: None,
        agent_count: None,
        project_id: None,
        workspace_root: None,
        attachment_ids: Vec::new(),
        client_mcp_tools: Vec::new(),
        client_user_message_id: None,
        permission_profile: None,
    }
}

#[test]
fn thread_query_compaction_and_permission_profiles_are_enforced() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let mut parent = imported_thread(ThreadState::Active);
    parent.id = "parent".to_string();
    parent.parent_thread_id = None;
    parent.title = "Searchable parent".to_string();
    for turn in &mut parent.turns {
        turn.status = TurnStatus::Completed;
        for item in &mut turn.items {
            item.status = ThreadItemStatus::Completed;
        }
    }
    parent.turns.extend(parent.turns.clone());
    runtime
        .thread_import(ThreadImportParams {
            thread: parent,
            overwrite: false,
        })
        .expect("import parent");
    let mut child = imported_thread(ThreadState::Paused);
    child.id = "child".to_string();
    child.parent_thread_id = Some("parent".to_string());
    runtime
        .thread_import(ThreadImportParams {
            thread: child,
            overwrite: false,
        })
        .expect("import child");

    let filtered = response_json(
        runtime
            .thread_list(ThreadListParams {
                search: Some("searchable".to_string()),
                state: Some(ThreadState::Active),
                ..ThreadListParams::default()
            })
            .expect("filter threads"),
    );
    assert_eq!(filtered["threads"].as_array().unwrap().len(), 1);
    let children = response_json(
        runtime
            .thread_children(ThreadIDParams {
                thread_id: "parent".to_string(),
            })
            .expect("list children"),
    );
    assert_eq!(children["threads"][0]["id"], "child");
    let statuses = response_json(runtime.thread_status_list().expect("list statuses"));
    assert_eq!(statuses["statuses"].as_array().unwrap().len(), 2);

    let compacted = response_json(
        runtime
            .thread_compact(ThreadCompactParams {
                thread_id: "parent".to_string(),
                keep_last_turns: Some(1),
                max_summary_chars: Some(1_000),
            })
            .expect("compact parent"),
    );
    assert_eq!(compacted["compactedTurnCount"], 3);
    assert_eq!(compacted["summaryItem"]["type"], "compaction");

    assert!(permission_flags(PermissionProfile::ReadOnly, Some(true), None, None,).is_err());
    assert!(filter_client_tools(
        vec![ClientMcpTool {
            server_name: "workspace".to_string(),
            tool_name: "write_file".to_string(),
            title: None,
            description: None,
        }],
        PermissionProfile::ReadOnly,
    )
    .is_err());
}

#[tokio::test]
async fn turn_start_exact_retry_reuses_client_message_id() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .thread_start(ThreadStartParams {
            objective: "Retry safely".to_string(),
            thread_id: Some("retry-thread".to_string()),
            title: None,
            source: None,
            task_mode: TaskMode::Chat,
            settings: None,
        })
        .expect("start thread");
    let mut first = turn_start_params("retry-thread", "hello");
    first.client_user_message_id = Some("client-message-1".to_string());
    let first = response_json(runtime.turn_start(first).await.expect("start first turn"));
    let mut retry = turn_start_params("retry-thread", "hello");
    retry.client_user_message_id = Some("client-message-1".to_string());
    let retry = response_json(runtime.turn_start(retry).await.expect("retry turn"));
    assert_eq!(first["run"]["id"], retry["run"]["id"]);
    assert_eq!(
        response_json(
            runtime
                .thread_read(ThreadIDParams {
                    thread_id: "retry-thread".to_string(),
                })
                .expect("read thread")
        )["thread"]["turns"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let mut conflict = turn_start_params("retry-thread", "different");
    conflict.client_user_message_id = Some("client-message-1".to_string());
    assert!(runtime.turn_start(conflict).await.is_err());
}

#[tokio::test]
async fn turn_input_keeps_execution_context_out_of_visible_messages() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .thread_start(ThreadStartParams {
            objective: "Build a game".to_string(),
            thread_id: Some("display-input-thread".to_string()),
            title: None,
            source: None,
            task_mode: TaskMode::Code,
            settings: None,
        })
        .expect("start thread");
    let mut params = turn_start_params(
        "display-input-thread",
        "hidden workspace and project instructions\n\nUser request:\nBuild a game",
    );
    params.display_input = Some("Build a game".to_string());

    let started = response_json(runtime.turn_start(params).await.expect("start turn"));

    assert_eq!(
        started["run"]["prompt"],
        "hidden workspace and project instructions\n\nUser request:\nBuild a game"
    );
    assert_eq!(
        started["turn"]["items"][0]["content"]["text"],
        "Build a game"
    );

    let steered = response_json(
        runtime
            .turn_steer(TurnSteerParams {
                thread_id: "display-input-thread".to_string(),
                input: "hidden follow-up context\n\nUser request:\nMake it 3D".to_string(),
                display_input: Some("Make it 3D".to_string()),
            })
            .await
            .expect("steer turn"),
    );
    assert_eq!(
        steered["turn"]["items"]
            .as_array()
            .and_then(|items| items.last())
            .and_then(|item| item.get("content"))
            .and_then(|content| content.get("text")),
        Some(&serde_json::json!("Make it 3D"))
    );
}

#[tokio::test]
async fn turn_validation_and_thread_cancel_cover_inactive_and_owned_run_paths() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    assert!(runtime
        .turn_start(turn_start_params("missing", " "))
        .await
        .is_err());
    assert!(runtime
        .turn_steer(TurnSteerParams {
            thread_id: "missing".to_string(),
            input: " ".to_string(),
            display_input: None,
        })
        .await
        .is_err());
    runtime
        .thread_import(ThreadImportParams {
            thread: imported_thread(ThreadState::Active),
            overwrite: false,
        })
        .expect("import fixture");
    runtime
        .thread_archive(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("archive thread");
    assert!(runtime
        .turn_start(turn_start_params("imported", "continue"))
        .await
        .is_err());
    runtime
        .update_thread("imported", |thread| {
            thread.archived = false;
            thread.state = ThreadState::Canceled;
        })
        .expect("cancel fixture thread");
    assert!(runtime
        .turn_start(turn_start_params("imported", "continue"))
        .await
        .is_err());
    assert!(runtime
        .turn_steer(TurnSteerParams {
            thread_id: "imported".to_string(),
            input: "continue".to_string(),
            display_input: None,
        })
        .await
        .is_err());

    runtime
        .update_thread("imported", |thread| thread.state = ThreadState::Active)
        .expect("activate fixture thread");
    let mut sessions = runtime.agent_sessions().expect("sessions");
    sessions[0].active_run_id = Some("local_run_owned".to_string());
    sessions[0].run_ids.push("local_run_owned".to_string());
    runtime
        .save_agent_sessions(&sessions)
        .expect("save owned run");
    runtime.runs.insert(
        "local_run_owned".to_string(),
        RunRecord {
            id: "local_run_owned".to_string(),
            prompt: "owned".to_string(),
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
    let (output, _messages) = tokio::sync::mpsc::channel(1);
    runtime.set_interaction_broker(crate::interactions::InteractionBroker::new(output));
    let response = runtime
        .thread_cancel(ThreadIDParams {
            thread_id: "imported".to_string(),
        })
        .expect("cancel owned run thread");
    assert!(matches!(response, AppResponse::WithEvents { .. }));
    tokio::task::yield_now().await;
}

#[tokio::test]
async fn code_turns_prepare_selected_project_workspaces() {
    let mut unauthenticated = AppRuntime::new(RuntimeConfig::default());
    assert!(unauthenticated
        .project_workspace_set(ProjectWorkspaceSetParams {
            project_id: 0,
            workspace_roots: Vec::new(),
        })
        .is_err());
    unauthenticated
        .thread_start(ThreadStartParams {
            objective: "Edit a local project".to_string(),
            thread_id: Some("code-thread".to_string()),
            title: None,
            source: None,
            task_mode: TaskMode::Code,
            settings: None,
        })
        .expect("code thread should start");
    let mut params = turn_start_params("code-thread", "Fix the tests");
    params.project_id = Some(1);
    assert_eq!(
        unauthenticated
            .turn_start(params)
            .await
            .expect_err("Code project should require login")
            .message,
        "login required for Code projects"
    );

    let workspace = std::env::temp_dir().join(format!("taskforceai-code-{}", unix_millis()));
    std::fs::create_dir_all(&workspace).expect("workspace should exist");
    let workspace = workspace
        .canonicalize()
        .expect("workspace should canonicalize");
    let missing_json = serde_json::to_string(&workspace.join("missing").to_string_lossy()).unwrap();
    let (api_base_url, server) = project_api(vec![
        "[]".to_string(),
        json!([{"id": 2, "name": "Empty", "workspaceRoots": []}]).to_string(),
        format!("[{{\"id\":3,\"name\":\"Missing\",\"workspaceRoots\":[{missing_json}]}}]"),
        json!([{"id": 4, "name": "Ready"}]).to_string(),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .set_auth_token(Some("token"))
        .expect("auth token should set");
    runtime
        .project_workspace_set(ProjectWorkspaceSetParams {
            project_id: 4,
            workspace_roots: vec![
                workspace.display().to_string(),
                workspace.display().to_string(),
            ],
        })
        .expect("local project workspace should persist");

    assert_eq!(
        runtime
            .prepare_project_code_input(
                1,
                "Fix the tests",
                None,
                PermissionProfile::WorkspaceWrite,
            )
            .await
            .expect_err("missing project should fail")
            .message,
        "project not found"
    );
    assert_eq!(
        runtime
            .prepare_project_code_input(
                2,
                "Fix the tests",
                None,
                PermissionProfile::WorkspaceWrite,
            )
            .await
            .expect_err("empty workspace should fail")
            .message,
        "The selected project does not have a local workspace"
    );
    assert!(runtime
        .prepare_project_code_input(3, "Fix the tests", None, PermissionProfile::WorkspaceWrite,)
        .await
        .expect_err("missing workspace should fail")
        .message
        .starts_with("Project workspace is unavailable:"));
    let prompt = runtime
        .prepare_project_code_input(4, "Fix the tests", None, PermissionProfile::WorkspaceWrite)
        .await
        .expect("valid workspace should prepare");
    assert!(prompt.contains(&workspace.display().to_string()));
    assert!(prompt.ends_with("User request:\nFix the tests"));
    assert_eq!(
        runtime.active_project_id().expect("active project"),
        Some(4)
    );
    let workspace_server = runtime
        .mcp_servers()
        .expect("MCP servers should load")
        .into_iter()
        .find(|server| server.name == "workspace")
        .expect("workspace MCP server should exist");
    assert!(workspace_server.enabled);
    assert!(workspace_server
        .endpoint
        .contains(&workspace.display().to_string()));
    assert_eq!(workspace_server.tools.len(), 12);

    server.join().expect("project API should finish");
    std::fs::remove_dir_all(&workspace).expect("workspace should clean up");
}
