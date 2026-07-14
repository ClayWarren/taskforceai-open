use super::super::support::{result_value, submit_run_params, test_store_path};
use super::super::*;

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
fn private_run_assistant_message_is_not_persisted() {
    let store_path = test_store_path("private-assistant-message");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    let run = RunRecord {
        id: "private_run_1".to_string(),
        prompt: "keep this private".to_string(),
        model_id: Some("sentinel".to_string()),
        project_id: None,
        status: RunStatus::Completed,
        output: Some("private answer".to_string()),
        error: None,
        created_at: 1,
        updated_at: 2,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };
    runtime.private_run_ids.insert(run.id.clone());

    runtime
        .persist_assistant_message(&run)
        .expect("private assistant message persistence should no-op");

    let messages = result_value(
        runtime
            .message_list(ConversationIDParams {
                conversation_id: run.id,
            })
            .expect("message list should work"),
    );
    assert!(messages["messages"]
        .as_array()
        .expect("messages")
        .is_empty());

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
        .pending_prompt_add(PendingPromptRecord {
            id: "pending-clear".to_string(),
            prompt: "retry me".to_string(),
            model_id: None,
            reasoning_effort: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        })
        .expect("pending prompt add should work");
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
            reasoning_effort: None,
            attachment_ids: vec!["attachment-1".to_string()],
        })
        .await
        .expect("prompt queue add should work");
    runtime
        .run_submit(submit_run_params("sensitive local run"))
        .await
        .expect("run submit should work");

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
    assert!(result_value(runtime.pending_prompt_list())["prompts"]
        .as_array()
        .expect("pending prompts")
        .is_empty());
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
    assert!(
        result_value(runtime.history_list(HistoryListParams { limit: 10 }))["runs"]
            .as_array()
            .expect("runs")
            .is_empty()
    );

    let restarted = AppRuntime::try_new(RuntimeConfig::default().with_run_store_path(&store_path))
        .expect("runtime should restart after clear");
    assert!(
        result_value(restarted.history_list(HistoryListParams { limit: 10 }))["runs"]
            .as_array()
            .expect("restarted runs")
            .is_empty()
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
                model_id: Some("openai/gpt-5.6-sol".to_string()),
                reasoning_effort: Some("max".to_string()),
                attachment_ids: vec!["att-1".to_string()],
            })
            .await
            .expect("prompt queue add should work"),
    );
    let id = added["queuedPrompt"]["id"].as_i64().expect("queue id");
    assert_eq!(added["queuedPrompt"]["dispatchTiming"], "after_response");

    let queued = result_value(runtime.prompt_queue_list().expect("list should work"));
    assert_eq!(queued["queuedPrompts"][0]["attachmentIds"][0], "att-1");
    assert_eq!(queued["queuedPrompts"][0]["reasoningEffort"], "max");
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
            model_id: Some("openai/gpt-5.6-sol".to_string()),
            reasoning_effort: Some("max".to_string()),
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
    assert_eq!(run.model_id.as_deref(), Some("openai/gpt-5.6-sol"));
    assert_eq!(
        result.queued_prompt.reasoning_effort.as_deref(),
        Some("max")
    );
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
                reasoning_effort: None,
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
