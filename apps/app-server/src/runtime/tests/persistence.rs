use super::support::{result_value, submit_run_params, test_store_path};
use super::*;

#[test]
fn conversation_message_and_queue_wrappers_validate_empty_ids_without_store() {
    let runtime = AppRuntime::new(RuntimeConfig::default());

    assert_eq!(
        runtime
            .conversation_get(ConversationIDParams {
                conversation_id: "   ".to_string(),
            })
            .expect_err("empty conversation get id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .conversation_delete(ConversationIDParams {
                conversation_id: "   ".to_string(),
            })
            .expect_err("empty conversation delete id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .conversation_replace_id(ConversationReplaceIDParams {
                old_conversation_id: String::new(),
                new_conversation_id: "new".to_string(),
            })
            .expect_err("empty old conversation id should fail")
            .message,
        "oldConversationId is required"
    );
    assert_eq!(
        runtime
            .conversation_replace_id(ConversationReplaceIDParams {
                old_conversation_id: "old".to_string(),
                new_conversation_id: "   ".to_string(),
            })
            .expect_err("empty new conversation id should fail")
            .message,
        "newConversationId is required"
    );
    assert_eq!(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: String::new(),
            })
            .expect_err("empty message list conversation id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .message_get(MessageIDParams {
                message_id: " ".to_string(),
            })
            .expect_err("empty message id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .message_delete(MessageIDParams {
                message_id: " ".to_string(),
            })
            .expect_err("empty message delete id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .pending_change_update_data(PendingChangeUpdateDataParams {
                id: 0,
                data: json!({}),
            })
            .expect_err("non-positive pending change update id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .pending_change_delete(PendingChangeIDParams { id: 0 })
            .expect_err("non-positive pending change delete id should fail")
            .code,
        -32602
    );
    assert_eq!(
        runtime
            .prompt_queue_delete(PromptQueueIDParams { id: 0 })
            .expect_err("non-positive prompt queue id should fail")
            .code,
        -32602
    );
}

#[tokio::test]
async fn conversation_message_and_queue_wrappers_succeed_without_store() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    assert!(result_value(
        runtime
            .conversation_list(ConversationListParams { limit: 500 })
            .expect("conversation list should work")
    )["conversations"]
        .as_array()
        .expect("conversations array")
        .is_empty());
    assert_eq!(
        result_value(
            runtime
                .conversation_get(ConversationIDParams {
                    conversation_id: "memory-conv".to_string(),
                })
                .expect("conversation get should work")
        )["conversation"],
        Value::Null
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_upsert(ConversationRecord {
                    conversation_id: "memory-conv".to_string(),
                    title: "Memory conversation".to_string(),
                    created_at: 1,
                    updated_at: 2,
                    last_message_preview: None,
                    ..ConversationRecord::default()
                })
                .expect("conversation upsert should work")
        )["conversation"]["conversationId"],
        "memory-conv"
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_delete(ConversationIDParams {
                    conversation_id: "memory-conv".to_string(),
                })
                .expect("conversation delete should work")
        )["ok"],
        true
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_delete_all()
                .expect("conversation delete all should work")
        )["ok"],
        true
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_replace_id(ConversationReplaceIDParams {
                    old_conversation_id: "memory-conv".to_string(),
                    new_conversation_id: "memory-conv-2".to_string(),
                })
                .expect("conversation replace should work")
        )["ok"],
        true
    );

    assert!(result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "memory-conv".to_string(),
            })
            .expect("message list should work")
    )["messages"]
        .as_array()
        .expect("messages array")
        .is_empty());
    assert_eq!(
        result_value(
            runtime
                .message_get(MessageIDParams {
                    message_id: "memory-msg".to_string(),
                })
                .expect("message get should work")
        )["message"],
        Value::Null
    );
    assert_eq!(
        result_value(
            runtime
                .message_upsert(MessageRecord {
                    message_id: "memory-msg".to_string(),
                    conversation_id: "memory-conv".to_string(),
                    role: "user".to_string(),
                    content: "hello".to_string(),
                    created_at: 1,
                    updated_at: 1,
                    ..MessageRecord::default()
                })
                .expect("message upsert should work")
        )["message"]["messageId"],
        "memory-msg"
    );
    assert_eq!(
        result_value(
            runtime
                .message_delete(MessageIDParams {
                    message_id: "memory-msg".to_string(),
                })
                .expect("message delete should work")
        )["ok"],
        true
    );

    assert!(result_value(
        runtime
            .pending_change_list()
            .expect("pending change list should work")
    )["pendingChanges"]
        .as_array()
        .expect("pending changes array")
        .is_empty());
    assert_eq!(
        result_value(
            runtime
                .pending_change_add(PendingChangeRecord {
                    id: None,
                    change_type: "message".to_string(),
                    entity_id: "memory-msg".to_string(),
                    operation: "create".to_string(),
                    data: json!({"messageId": "memory-msg"}),
                    created_at: 1,
                })
                .expect("pending change add should work")
        )["pendingChange"]["entityId"],
        "memory-msg"
    );
    assert_eq!(
        result_value(
            runtime
                .pending_change_update_data(PendingChangeUpdateDataParams {
                    id: 1,
                    data: json!({"ok": true}),
                })
                .expect("pending change update should work")
        )["ok"],
        true
    );
    assert_eq!(
        result_value(
            runtime
                .pending_change_delete(PendingChangeIDParams { id: 1 })
                .expect("pending change delete should work")
        )["ok"],
        true
    );
    assert_eq!(
        result_value(
            runtime
                .pending_change_clear()
                .expect("pending change clear should work")
        )["ok"],
        true
    );

    assert!(result_value(
        runtime
            .prompt_queue_list()
            .expect("prompt queue list should work")
    )["queuedPrompts"]
        .as_array()
        .expect("queued prompts array")
        .is_empty());
    let queued = result_value(
        runtime
            .prompt_queue_add(PromptQueueRecord {
                id: None,
                conversation_id: "memory-conv".to_string(),
                prompt: "follow up".to_string(),
                status: "queued".to_string(),
                dispatch_timing: "after_response".to_string(),
                created_at: 1,
                updated_at: 1,
                model_id: None,
                attachment_ids: Vec::new(),
            })
            .await
            .expect("prompt queue add should work"),
    );
    assert_eq!(queued["run"], Value::Null);
    let dispatch = result_value(
        runtime
            .prompt_queue_dispatch_after_response(PromptQueueDispatchAfterResponseParams {
                conversation_id: Some("memory-conv".to_string()),
            })
            .await
            .expect("dispatch without store should work"),
    );
    assert_eq!(dispatch["dispatched"], false);
}

#[tokio::test]
async fn sqlite_store_persists_runs_across_runtime_instances() {
    let store_path = test_store_path("persists-runs");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
    runtime
        .run_submit(SubmitRunParams {
            model_id: Some("sentinel".to_string()),
            project_id: Some(7),
            ..submit_run_params("persist me")
        })
        .await
        .expect("submit should persist");

    let runtime = AppRuntime::try_new(config).expect("runtime should reload persisted state");
    let AppResponse::Value(history) = runtime.history_list(HistoryListParams { limit: 10 }) else {
        panic!("expected history response");
    };

    assert_eq!(history["runs"][0]["id"], "local_run_1");
    assert_eq!(history["runs"][0]["prompt"], "persist me");
    assert_eq!(history["runs"][0]["projectId"], 7);

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn failed_remote_submit_queues_pending_prompt() {
    let store_path = test_store_path("pending-prompts");
    let config = RuntimeConfig {
        api_base_url: "http://127.0.0.1:1/api/v1".to_string(),
        ..RuntimeConfig::default().with_run_store_path(&store_path)
    };
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");

    let response = runtime
        .run_submit(SubmitRunParams {
            model_id: Some("gpt-test".to_string()),
            project_id: Some(42),
            ..submit_run_params("retry me")
        })
        .await
        .expect("failed remote submit should return failed run");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected submit response with events");
    };
    assert_eq!(result["run"]["status"], "failed");

    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(pending["prompts"][0]["prompt"], "retry me");
    assert_eq!(pending["prompts"][0]["modelId"], "gpt-test");
    assert_eq!(pending["prompts"][0]["projectId"], 42);

    let runtime = AppRuntime::try_new(config).expect("runtime should reload pending prompts");
    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(pending["prompts"][0]["prompt"], "retry me");

    let mut runtime =
        AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store_path))
            .expect("runtime should reload pending prompts for delete");
    runtime
        .pending_prompt_delete(PendingPromptIDParams {
            pending_prompt_id: pending["prompts"][0]["id"]
                .as_str()
                .expect("pending prompt id should be string")
                .to_string(),
        })
        .expect("pending prompt delete should succeed");
    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(
        pending["prompts"]
            .as_array()
            .expect("prompts should be array")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn pending_prompt_add_persists_explicit_queue_item() {
    let store_path = test_store_path("pending-prompt-add");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");

    let added = result_value(
        runtime
            .pending_prompt_add(PendingPromptRecord {
                id: "manual-pending".to_string(),
                prompt: "retry this".to_string(),
                model_id: Some("gpt-5".to_string()),
                project_id: Some(1),
                status: PendingPromptStatus::Queued,
                retry_count: 0,
                last_error: None,
                created_at: 1,
                updated_at: 1,
            })
            .expect("pending prompt add should work"),
    );
    assert_eq!(added["prompt"]["id"], "manual-pending");

    let runtime = AppRuntime::try_new(config).expect("runtime should reload pending prompts");
    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(pending["prompts"][0]["prompt"], "retry this");

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn sqlite_store_migrates_legacy_desktop_pending_prompts() {
    let store_path = test_store_path("legacy-desktop-pending-prompts");
    {
        let connection =
            rusqlite::Connection::open(&store_path).expect("legacy database should open");
        connection
                .execute_batch(
                    "create table pending_prompts (
                        id text primary key,
                        prompt text not null,
                        conversation_id text,
                        created_at integer not null,
                        retry_count integer not null default 0,
                        last_error text,
                        model_id text
                    );
                    insert into pending_prompts (
                        id, prompt, conversation_id, created_at, retry_count, last_error, model_id
                    ) values (
                        'pending_legacy', 'legacy prompt', 'conversation_1', 10, 2, 'offline', 'gpt-5'
                    );",
                )
                .expect("legacy pending prompt should be inserted");
    }

    let runtime = AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store_path))
        .expect("runtime should migrate legacy pending prompts");
    let pending = result_value(runtime.pending_prompt_list());

    assert_eq!(pending["prompts"][0]["id"], "pending_legacy");
    assert_eq!(pending["prompts"][0]["status"], "queued");
    assert_eq!(pending["prompts"][0]["projectId"], serde_json::Value::Null);
    assert_eq!(pending["prompts"][0]["updatedAt"], 0);

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn pending_prompt_replay_submits_and_removes_prompt() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let now = unix_millis();
    let failed_run = RunRecord {
        id: "run_replay_seed".to_string(),
        prompt: "retry this".to_string(),
        model_id: Some("gpt-test".to_string()),
        project_id: Some(7),
        status: RunStatus::Failed,
        output: None,
        error: Some("network down".to_string()),
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    runtime
        .queue_pending_prompt(&failed_run, failed_run.error.clone())
        .expect("pending prompt should queue");

    let replayed = result_value(
        runtime
            .pending_prompt_replay()
            .await
            .expect("pending prompt should replay"),
    );

    assert_eq!(replayed["attempted"], true);
    assert_eq!(replayed["run"]["prompt"], "retry this");
    assert_eq!(replayed["run"]["modelId"], "gpt-test");
    assert_eq!(replayed["run"]["projectId"], 7);
    assert_eq!(replayed["remaining"], 0);

    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(
        pending["prompts"]
            .as_array()
            .expect("prompts should be array")
            .len(),
        0
    );
}

#[tokio::test]
async fn pending_prompt_replay_recovers_previously_claimed_prompt() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let now = unix_millis();

    runtime
        .pending_prompt_add(PendingPromptRecord {
            id: "pending_claimed".to_string(),
            prompt: "resume claimed prompt".to_string(),
            model_id: Some("gpt-test".to_string()),
            project_id: Some(9),
            status: PendingPromptStatus::Pending,
            retry_count: 1,
            last_error: Some("interrupted".to_string()),
            created_at: now,
            updated_at: now,
        })
        .expect("pending prompt add should work");

    let replayed = result_value(
        runtime
            .pending_prompt_replay()
            .await
            .expect("claimed pending prompt should replay"),
    );

    assert_eq!(replayed["attempted"], true);
    assert_eq!(replayed["run"]["prompt"], "resume claimed prompt");
    assert_eq!(replayed["run"]["projectId"], 9);
    assert_eq!(replayed["remaining"], 0);

    let pending = result_value(runtime.pending_prompt_list());
    assert_eq!(
        pending["prompts"]
            .as_array()
            .expect("prompts should be array")
            .len(),
        0
    );
}

#[tokio::test]
async fn sqlite_store_continues_local_run_sequence_after_reload() {
    let store_path = test_store_path("continues-sequence");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config.clone()).expect("runtime should start");
    runtime
        .run_submit(submit_run_params("first"))
        .await
        .expect("first submit should persist");

    let mut runtime = AppRuntime::try_new(config).expect("runtime should reload persisted state");
    let response = runtime
        .run_submit(submit_run_params("second"))
        .await
        .expect("second submit should persist");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };

    assert_eq!(result["run"]["id"], "local_run_2");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn sqlite_store_persists_conversation_and_message_for_submitted_run() {
    let store_path = test_store_path("conversation-message");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .run_submit(submit_run_params("write a concise migration note"))
        .await
        .expect("submit should persist");

    let conversations = result_value(
        runtime
            .conversation_list(ConversationListParams { limit: 10 })
            .expect("conversation list should work"),
    );
    assert_eq!(
        conversations["conversations"][0]["conversationId"],
        "local_run_1"
    );
    assert_eq!(
        conversations["conversations"][0]["title"],
        "write a concise migration note"
    );

    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "local_run_1".to_string(),
            })
            .expect("message list should work"),
    );
    assert_eq!(messages["messages"][0]["role"], "user");
    assert_eq!(
        messages["messages"][0]["content"],
        "write a concise migration note"
    );

    let conversation = result_value(
        runtime
            .conversation_get(ConversationIDParams {
                conversation_id: "local_run_1".to_string(),
            })
            .expect("conversation get should work"),
    );
    assert_eq!(
        conversation["conversation"]["conversationId"],
        "local_run_1"
    );

    let message = result_value(
        runtime
            .message_get(MessageIDParams {
                message_id: "local_run_1_user".to_string(),
            })
            .expect("message get should work"),
    );
    assert_eq!(message["message"]["role"], "user");

    result_value(
        runtime
            .conversation_delete(ConversationIDParams {
                conversation_id: "local_run_1".to_string(),
            })
            .expect("conversation delete should work"),
    );
    let message = result_value(
        runtime
            .message_get(MessageIDParams {
                message_id: "local_run_1_user".to_string(),
            })
            .expect("message get should work"),
    );
    assert_eq!(message["message"], Value::Null);
    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "local_run_1".to_string(),
            })
            .expect("message list should work"),
    );
    assert_eq!(messages["messages"].as_array().expect("messages").len(), 0);

    let conversations = result_value(
        runtime
            .conversation_list(ConversationListParams { limit: 10 })
            .expect("conversation list should work"),
    );
    assert_eq!(
        conversations["conversations"]
            .as_array()
            .expect("conversations")
            .len(),
        0
    );

    let conversation = ConversationRecord {
        conversation_id: "manual_conversation".to_string(),
        title: "Manual conversation".to_string(),
        created_at: 11,
        updated_at: 12,
        last_message_preview: Some("preview".to_string()),
        ..ConversationRecord::default()
    };
    let upserted = result_value(
        runtime
            .conversation_upsert(conversation)
            .expect("conversation upsert should work"),
    );
    assert_eq!(
        upserted["conversation"]["conversationId"],
        "manual_conversation"
    );

    let message = MessageRecord {
        message_id: "manual_message".to_string(),
        conversation_id: "manual_conversation".to_string(),
        role: "assistant".to_string(),
        content: "manual reply".to_string(),
        created_at: 13,
        updated_at: 14,
        ..MessageRecord::default()
    };
    let upserted = result_value(
        runtime
            .message_upsert(message)
            .expect("message upsert should work"),
    );
    assert_eq!(upserted["message"]["messageId"], "manual_message");
    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "manual_conversation".to_string(),
            })
            .expect("message list should work"),
    );
    assert_eq!(messages["messages"][0]["content"], "manual reply");

    result_value(
        runtime
            .conversation_replace_id(ConversationReplaceIDParams {
                old_conversation_id: "manual_conversation".to_string(),
                new_conversation_id: "manual_conversation_remote".to_string(),
            })
            .expect("conversation replace id should work"),
    );
    let message = result_value(
        runtime
            .message_get(MessageIDParams {
                message_id: "manual_message".to_string(),
            })
            .expect("message get should work"),
    );
    assert_eq!(
        message["message"]["conversationId"],
        "manual_conversation_remote"
    );

    let pending_change = result_value(
        runtime
            .pending_change_add(PendingChangeRecord {
                id: None,
                change_type: "conversation".to_string(),
                entity_id: "manual_conversation_remote".to_string(),
                operation: "update".to_string(),
                data: json!({"conversationId": "manual_conversation_remote"}),
                created_at: 15,
            })
            .expect("pending change add should work"),
    );
    let pending_change_id = pending_change["pendingChange"]["id"]
        .as_i64()
        .expect("pending change id should be returned");
    result_value(
        runtime
            .pending_change_update_data(PendingChangeUpdateDataParams {
                id: pending_change_id,
                data: json!({"conversationId": "manual_conversation_remote", "synced": true}),
            })
            .expect("pending change update should work"),
    );
    let pending_changes = result_value(
        runtime
            .pending_change_list()
            .expect("pending change list should work"),
    );
    assert_eq!(pending_changes["pendingChanges"][0]["data"]["synced"], true);
    result_value(
        runtime
            .pending_change_delete(PendingChangeIDParams {
                id: pending_change_id,
            })
            .expect("pending change delete should work"),
    );
    let pending_changes = result_value(
        runtime
            .pending_change_list()
            .expect("pending change list should work"),
    );
    assert_eq!(
        pending_changes["pendingChanges"]
            .as_array()
            .expect("pending changes")
            .len(),
        0
    );

    result_value(
        runtime
            .conversation_upsert(ConversationRecord {
                conversation_id: "archived_manual".to_string(),
                title: "Archived manual".to_string(),
                created_at: 16,
                updated_at: 17,
                is_archived: true,
                ..ConversationRecord::default()
            })
            .expect("archived conversation upsert should work"),
    );
    result_value(
        runtime
            .message_upsert(MessageRecord {
                message_id: "archived_message".to_string(),
                conversation_id: "archived_manual".to_string(),
                role: "user".to_string(),
                content: "archived content".to_string(),
                created_at: 18,
                updated_at: 19,
                ..MessageRecord::default()
            })
            .expect("archived message upsert should work"),
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_list(ConversationListParams { limit: 10 })
                .expect("conversation list should hide archived")
        )["conversations"]
            .as_array()
            .expect("conversations")
            .len(),
        1
    );
    result_value(
        runtime
            .conversation_delete_all()
            .expect("conversation delete all should work"),
    );
    assert_eq!(
        result_value(
            runtime
                .conversation_get(ConversationIDParams {
                    conversation_id: "archived_manual".to_string(),
                })
                .expect("archived conversation should be gone")
        )["conversation"],
        Value::Null
    );
    assert_eq!(
        result_value(
            runtime
                .message_get(MessageIDParams {
                    message_id: "archived_message".to_string(),
                })
                .expect("archived message should be gone")
        )["message"],
        Value::Null
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn completed_run_persists_assistant_message() {
    let store_path = test_store_path("assistant-message");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    runtime
        .run_submit(submit_run_params("hello assistant"))
        .await
        .expect("submit should persist");

    let mut completed = match runtime.get_run("local_run_1") {
        Ok(run) => run,
        Err(err) => panic!("expected run: {err}"),
    };
    completed.status = RunStatus::Completed;
    completed.output = Some("assistant reply".to_string());
    completed.updated_at = completed.created_at + 10;
    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(completed),
        })
        .expect("completed event should persist");

    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: "local_run_1".to_string(),
            })
            .expect("message list should work"),
    );
    assert_eq!(messages["messages"].as_array().expect("messages").len(), 2);
    assert_eq!(messages["messages"][1]["role"], "assistant");
    assert_eq!(messages["messages"][1]["content"], "assistant reply");

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn metadata_round_trips_supported_keys() {
    let store_path = test_store_path("metadata");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let result = result_value(
        runtime
            .metadata_set(MetadataSetParams {
                key: "device_id".to_string(),
                value: "device-a".to_string(),
            })
            .expect("metadata set should work"),
    );
    assert_eq!(result["ok"], true);

    let result = result_value(
        runtime
            .metadata_get(MetadataGetParams {
                key: "device_id".to_string(),
            })
            .expect("metadata get should work"),
    );
    assert_eq!(result["value"], "device-a");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn metadata_clear_all_removes_local_storage_state() {
    let store_path = test_store_path("metadata-clear-all");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    runtime
        .metadata_set(MetadataSetParams {
            key: "device_id".to_string(),
            value: "device-clear".to_string(),
        })
        .expect("metadata set should work");
    runtime
        .conversation_upsert(ConversationRecord {
            conversation_id: "clear-conv".to_string(),
            title: "Clear conversation".to_string(),
            created_at: 1,
            updated_at: 2,
            last_message_preview: None,
            ..ConversationRecord::default()
        })
        .expect("conversation upsert should work");
    runtime
        .message_upsert(MessageRecord {
            message_id: "clear-msg".to_string(),
            conversation_id: "clear-conv".to_string(),
            role: "user".to_string(),
            content: "clear me".to_string(),
            created_at: 1,
            updated_at: 1,
            ..MessageRecord::default()
        })
        .expect("message upsert should work");
    runtime
        .pending_change_add(PendingChangeRecord {
            id: None,
            change_type: "message".to_string(),
            entity_id: "clear-msg".to_string(),
            operation: "create".to_string(),
            data: json!({"messageId": "clear-msg"}),
            created_at: 1,
        })
        .expect("pending change add should work");
    runtime
        .prompt_queue_add(PromptQueueRecord {
            id: None,
            conversation_id: "clear-conv".to_string(),
            prompt: "follow up".to_string(),
            status: "queued".to_string(),
            dispatch_timing: "after_response".to_string(),
            created_at: 1,
            updated_at: 1,
            model_id: Some("gpt-5".to_string()),
            attachment_ids: vec!["attachment-1".to_string()],
        })
        .await
        .expect("prompt queue add should work");

    let result = result_value(
        runtime
            .metadata_clear_all()
            .expect("metadata clear all should work"),
    );
    assert_eq!(result["ok"], true);

    assert!(result_value(
        runtime
            .metadata_get(MetadataGetParams {
                key: "device_id".to_string(),
            })
            .expect("metadata get should work")
    )["value"]
        .is_null());
    assert_eq!(
        result_value(
            runtime
                .conversation_list(ConversationListParams { limit: 10 })
                .expect("conversation list should work")
        )["conversations"]
            .as_array()
            .expect("conversations")
            .len(),
        0
    );
    assert_eq!(
        result_value(
            runtime
                .pending_change_list()
                .expect("pending change list should work")
        )["pendingChanges"]
            .as_array()
            .expect("pending changes")
            .len(),
        0
    );
    assert_eq!(
        result_value(
            runtime
                .prompt_queue_list()
                .expect("prompt queue list should work")
        )["queuedPrompts"]
            .as_array()
            .expect("queued prompts")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn prompt_queue_round_trips_dispatch_timing() {
    let store_path = test_store_path("prompt-queue");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let added = result_value(
        runtime
            .prompt_queue_add(PromptQueueRecord {
                id: None,
                conversation_id: "conv-queue".to_string(),
                prompt: "next prompt".to_string(),
                status: "queued".to_string(),
                dispatch_timing: "after_response".to_string(),
                created_at: 10,
                updated_at: 11,
                model_id: Some("gpt-5".to_string()),
                attachment_ids: vec!["att-1".to_string()],
            })
            .await
            .expect("prompt queue add should work"),
    );
    let id = added["queuedPrompt"]["id"].as_i64().expect("queue id");
    assert_eq!(added["queuedPrompt"]["dispatchTiming"], "after_response");

    let queued = result_value(runtime.prompt_queue_list().expect("list should work"));
    assert_eq!(queued["queuedPrompts"][0]["attachmentIds"][0], "att-1");
    assert_eq!(
        queued["queuedPrompts"][0]["dispatchTiming"],
        "after_response"
    );

    result_value(
        runtime
            .prompt_queue_delete(PromptQueueIDParams { id })
            .expect("delete should work"),
    );
    let queued = result_value(runtime.prompt_queue_list().expect("list should work"));
    assert_eq!(
        queued["queuedPrompts"]
            .as_array()
            .expect("queued prompts")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn prompt_queue_immediate_dispatch_submits_and_clears_queue_item() {
    let store_path = test_store_path("prompt-queue-immediate");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let response = runtime
        .prompt_queue_add(PromptQueueRecord {
            id: None,
            conversation_id: "conv-immediate".to_string(),
            prompt: "send now".to_string(),
            status: "queued".to_string(),
            dispatch_timing: "immediate".to_string(),
            created_at: 10,
            updated_at: 11,
            model_id: Some("gpt-5".to_string()),
            attachment_ids: vec!["att-1".to_string()],
        })
        .await
        .expect("prompt queue add should dispatch");

    let AppResponse::WithEvents { result, events } = response else {
        panic!("immediate prompt queue add should return run events");
    };
    let result: PromptQueueResult =
        serde_json::from_value(result).expect("prompt queue result should decode");
    let run = result.run.expect("dispatched run should be returned");
    assert_eq!(run.prompt, "send now");
    assert_eq!(run.model_id.as_deref(), Some("gpt-5"));
    assert_eq!(events.len(), 1);
    assert_eq!(
        result_value(runtime.prompt_queue_list().expect("list should work"))["queuedPrompts"]
            .as_array()
            .expect("queued prompts")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn prompt_queue_after_response_dispatches_matching_conversation() {
    let store_path = test_store_path("prompt-queue-after-response");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    result_value(
        runtime
            .prompt_queue_add(PromptQueueRecord {
                id: None,
                conversation_id: "conv-target".to_string(),
                prompt: "send after target".to_string(),
                status: "queued".to_string(),
                dispatch_timing: "after_response".to_string(),
                created_at: 10,
                updated_at: 11,
                model_id: None,
                attachment_ids: Vec::new(),
            })
            .await
            .expect("prompt queue add should work"),
    );

    let response = runtime
        .prompt_queue_dispatch_after_response(PromptQueueDispatchAfterResponseParams {
            conversation_id: Some("conv-target".to_string()),
        })
        .await
        .expect("after-response dispatch should work");
    let AppResponse::WithEvents { result, events } = response else {
        panic!("after-response dispatch should return run events");
    };
    let result: PromptQueueDispatchResult =
        serde_json::from_value(result).expect("dispatch result should decode");
    assert!(result.dispatched);
    assert_eq!(
        result.run.expect("run should exist").prompt,
        "send after target"
    );
    assert_eq!(events.len(), 1);
    assert_eq!(result.remaining, 0);

    let queued = result_value(runtime.prompt_queue_list().expect("list should work"));
    assert_eq!(
        queued["queuedPrompts"]
            .as_array()
            .expect("queued prompts")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}
