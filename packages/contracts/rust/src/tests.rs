use super::*;
use serde_json::{json, Value};

fn sample_run() -> RunRecord {
    RunRecord {
        id: "run_123".to_string(),
        prompt: "ship it".to_string(),
        model_id: Some("model-a".to_string()),
        project_id: Some(42),
        status: RunStatus::Processing,
        output: None,
        error: None,
        created_at: 10,
        updated_at: 11,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

fn sample_turn() -> TurnRecord {
    TurnRecord {
        id: "turn_123".to_string(),
        thread_id: "thread_1".to_string(),
        run_id: "run_123".to_string(),
        status: TurnStatus::InProgress,
        items: Vec::new(),
        created_at: 10,
        updated_at: 11,
    }
}

#[test]
fn hook_records_default_missing_enabled_to_true() {
    let hook: HookRecord = serde_json::from_value(json!({
        "id": "hook_1",
        "event": "before_turn_start",
        "command": "echo",
        "cwd": "/tmp"
    }))
    .expect("legacy hook record should decode");

    assert!(hook.enabled);
}

#[test]
fn json_rpc_request_defaults_missing_params_to_null() {
    let request: JsonRpcRequest = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": 1,
        "method": "server.ping"
    }))
    .expect("request should decode");

    assert_eq!(request.jsonrpc.as_deref(), Some(JSONRPC_VERSION));
    assert_eq!(request.id, Some(json!(1)));
    assert_eq!(request.method.as_deref(), Some("server.ping"));
    assert_eq!(request.params, Value::Null);
}

#[test]
fn json_rpc_request_decodes_params_and_ignores_unknown_fields() {
    let request: JsonRpcRequest = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": 2,
        "method": "runs.submit",
        "params": { "prompt": "go" },
        "clientOnly": { "ignored": true }
    }))
    .expect("request should decode");

    assert_eq!(request.response_id(), Some(json!(2)));
    assert_eq!(request.params, json!({ "prompt": "go" }));
}

#[test]
fn json_rpc_request_rejects_non_object_payloads() {
    match serde_json::from_value::<JsonRpcRequest>(json!(["not", "an", "object"])) {
        Ok(_) => panic!("array should not decode as a JSON-RPC request"),
        Err(error) => assert!(
            error.to_string().contains("JSON-RPC request object"),
            "unexpected error: {error}"
        ),
    }
}

#[test]
fn json_rpc_request_distinguishes_null_id_from_notification() {
    let request: JsonRpcRequest = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": null,
        "method": "server.ping"
    }))
    .expect("request should decode");

    assert_eq!(request.id, None);
    assert!(!request.is_notification());
    assert_eq!(request.response_id(), Some(Value::Null));

    let notification: JsonRpcRequest = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "method": "server.ping"
    }))
    .expect("notification should decode");
    assert!(notification.is_notification());
    assert_eq!(notification.response_id(), None);
}

#[test]
fn json_rpc_request_rejects_duplicate_control_fields() {
    for (field, payload) in [
        (
            "jsonrpc",
            r#"{"jsonrpc":"2.0","jsonrpc":"2.0","id":1,"method":"server.ping"}"#,
        ),
        (
            "id",
            r#"{"jsonrpc":"2.0","id":1,"id":2,"method":"server.ping"}"#,
        ),
        (
            "method",
            r#"{"jsonrpc":"2.0","id":1,"method":"server.ping","method":"shutdown"}"#,
        ),
        (
            "params",
            r#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":null,"params":{}}"#,
        ),
    ] {
        let error = match serde_json::from_str::<JsonRpcRequest>(payload) {
            Ok(_) => panic!("duplicate request field should not decode"),
            Err(error) => error,
        };
        assert!(
            error
                .to_string()
                .contains(&format!("duplicate field `{field}`")),
            "unexpected error for {field}: {error}"
        );
    }
}

#[test]
fn json_rpc_response_omits_absent_optional_fields() {
    let response = JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: Some(json!("abc")),
        result: Some(json!({ "ok": true })),
        error: None,
    };

    assert_eq!(
        serde_json::to_value(response).expect("response should encode"),
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": "abc",
            "result": { "ok": true }
        })
    );
}

#[test]
fn json_rpc_response_preserves_explicit_null_result() {
    let response: JsonRpcResponse = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": 1,
        "result": null
    }))
    .expect("response should decode");

    assert_eq!(response.result, Some(Value::Null));
}

#[test]
fn json_rpc_response_rejects_ambiguous_or_invalid_envelopes() {
    for payload in [
        json!({ "jsonrpc": JSONRPC_VERSION, "id": 1 }),
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": 1,
            "result": null,
            "error": { "code": -32603, "message": "Internal error" }
        }),
        json!({ "jsonrpc": JSONRPC_VERSION, "id": 1, "error": null }),
        json!({ "jsonrpc": "1.0", "id": 1, "result": null }),
    ] {
        serde_json::from_value::<JsonRpcResponse>(payload.clone())
            .expect_err("invalid direct response should not decode");
        serde_json::from_value::<OutgoingMessage>(payload)
            .expect_err("invalid outgoing response should not decode");
    }
    for payload in [
        json!({"jsonrpc": JSONRPC_VERSION, "method": "event", "params": {}}),
        json!({"jsonrpc": JSONRPC_VERSION, "id": 7, "method": "approval/request", "params": {}}),
    ] {
        serde_json::from_value::<JsonRpcResponse>(payload)
            .expect_err("request-like envelopes are not responses");
    }
}

#[test]
fn json_rpc_parse_error_serializes_null_id() {
    let response = JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: None,
        result: None,
        error: Some(JsonRpcError {
            code: -32700,
            message: "Parse error".to_string(),
            data: None,
        }),
    };

    assert_eq!(
        serde_json::to_value(response).expect("response should encode"),
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": null,
            "error": {
                "code": -32700,
                "message": "Parse error"
            }
        })
    );
}

#[test]
fn json_rpc_error_preserves_optional_data() {
    let error: JsonRpcError = serde_json::from_value(json!({
        "code": -32602,
        "message": "Invalid params",
        "data": { "field": "limit" }
    }))
    .expect("error should decode");

    assert_eq!(error.data, Some(json!({ "field": "limit" })));
    assert_eq!(
        serde_json::to_value(error).expect("error should encode"),
        json!({
            "code": -32602,
            "message": "Invalid params",
            "data": { "field": "limit" }
        })
    );
}

#[test]
fn outgoing_message_serializes_notifications_and_responses() {
    let notification = OutgoingMessage::Notification(JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: "event".to_string(),
        params: json!({ "type": "run_updated" }),
    });
    let response = OutgoingMessage::Response(JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id: Some(json!(7)),
        result: Some(json!({ "ok": true })),
        error: None,
    });

    assert_eq!(
        serde_json::to_value(notification).expect("notification should encode"),
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "method": "event",
            "params": { "type": "run_updated" }
        })
    );
    assert_eq!(
        serde_json::to_value(response).expect("response should encode"),
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": 7,
            "result": { "ok": true }
        })
    );
}

#[test]
fn outgoing_message_deserializes_method_messages_as_notifications() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "method": "event",
        "params": { "type": "run_updated" }
    }))
    .expect("message should decode");

    match message {
        OutgoingMessage::Notification(notification) => {
            assert_eq!(notification.method, "event");
            assert_eq!(notification.params, json!({ "type": "run_updated" }));
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Response(_) => {
            panic!("notification decoded as request or response")
        }
    }
}

#[test]
fn outgoing_message_deserializes_result_messages_as_responses() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": "request_1",
        "result": { "ok": true }
    }))
    .expect("message should decode");

    match message {
        OutgoingMessage::Response(response) => {
            assert_eq!(response.id, Some(json!("request_1")));
            assert_eq!(response.result, Some(json!({ "ok": true })));
            assert!(response.error.is_none());
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Notification(_) => {
            panic!("response decoded as request or notification")
        }
    }
}

#[test]
fn outgoing_message_deserializes_error_messages_as_responses() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": "request_2",
        "error": {
            "code": -32603,
            "message": "Internal error",
            "data": { "retry": false }
        }
    }))
    .expect("error message should decode");

    match message {
        OutgoingMessage::Response(response) => {
            assert_eq!(response.id, Some(json!("request_2")));
            assert!(response.result.is_none());
            let error = response.error.expect("error should be present");
            assert_eq!(error.code, -32603);
            assert_eq!(error.message, "Internal error");
            assert_eq!(error.data, Some(json!({ "retry": false })));
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Notification(_) => {
            panic!("error response decoded as request or notification")
        }
    }
}

#[test]
fn outgoing_message_ignores_unknown_fields() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": null,
        "result": null,
        "serverOnly": { "ignored": true }
    }))
    .expect("message with unknown fields should decode");

    match message {
        OutgoingMessage::Response(response) => {
            assert_eq!(response.id, None);
            assert_eq!(response.result, Some(Value::Null));
            assert!(response.error.is_none());
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Notification(_) => {
            panic!("response decoded as request or notification")
        }
    }
}

#[test]
fn outgoing_message_defaults_missing_notification_params_to_null() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "method": "event"
    }))
    .expect("message should decode");

    match message {
        OutgoingMessage::Notification(notification) => {
            assert_eq!(notification.method, "event");
            assert_eq!(notification.params, Value::Null);
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Response(_) => {
            panic!("notification decoded as request or response")
        }
    }
}

#[test]
fn outgoing_message_deserializes_method_with_id_as_server_request() {
    let message: OutgoingMessage = serde_json::from_value(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": 41,
        "method": "item/tool/requestUserInput",
        "params": { "threadId": "thread-1" }
    }))
    .expect("server request should decode");

    match message {
        OutgoingMessage::Request(request) => {
            assert_eq!(request.id, json!(41));
            assert_eq!(request.method, "item/tool/requestUserInput");
            assert_eq!(request.params["threadId"], "thread-1");
        }
        _ => panic!("server request decoded as another message kind"),
    }
}

#[test]
fn outgoing_message_rejects_method_with_response_fields() {
    let error = serde_json::from_value::<OutgoingMessage>(json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": "request_1",
        "method": "client.request",
        "result": { "ok": true }
    }))
    .expect_err("method plus response fields should not decode");

    assert!(
        error.to_string().contains("must not mix method"),
        "unexpected error: {error}"
    );
}

#[test]
fn outgoing_message_rejects_response_without_id() {
    let error = serde_json::from_value::<OutgoingMessage>(json!({
        "jsonrpc": JSONRPC_VERSION,
        "result": { "ok": true }
    }))
    .expect_err("response without id should not decode");

    assert!(
        error.to_string().contains("missing field `id`"),
        "unexpected error: {error}"
    );
}

#[test]
fn outgoing_message_rejects_duplicate_response_fields() {
    let error = serde_json::from_str::<OutgoingMessage>(
        r#"{"jsonrpc":"2.0","id":1,"result":null,"result":{"ok":true}}"#,
    )
    .expect_err("duplicate result field should not decode");

    assert!(
        error.to_string().contains("duplicate field `result`"),
        "unexpected error: {error}"
    );
}

#[test]
fn outgoing_message_rejects_non_object_payloads() {
    let error = serde_json::from_value::<OutgoingMessage>(json!(["not", "an", "object"]))
        .expect_err("array should not decode as an outgoing message");

    assert!(
        error
            .to_string()
            .contains("JSON-RPC notification or response object"),
        "unexpected error: {error}"
    );
}

#[test]
fn computer_use_targets_keep_stable_string_values() {
    assert_eq!(ComputerUseTarget::Virtual.as_str(), "virtual");
    assert_eq!(ComputerUseTarget::Local.as_str(), "local");
}

#[test]
fn server_info_default_matches_protocol_constants() {
    assert_eq!(
        ServerInfo::default(),
        ServerInfo {
            name: "taskforceai-app-server".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            protocol_version: PROTOCOL_VERSION.to_string(),
        }
    );
}

#[test]
fn capabilities_default_missing_flags_to_false() {
    let capabilities: Capabilities = serde_json::from_value(json!({
        "runs": true
    }))
    .expect("capabilities should decode");

    assert!(!capabilities.auth);
    assert!(capabilities.runs);
    assert!(!capabilities.workflows);
}

#[test]
fn request_params_keep_wire_defaults_and_names() {
    let submit: SubmitRunParams =
        serde_json::from_value(json!({ "prompt": "go" })).expect("submit should decode");
    assert_eq!(submit.prompt, "go");
    assert_eq!(submit.model_id, None);
    assert_eq!(submit.attachment_ids, Vec::<String>::new());

    let mcp: McpServerAddParams = serde_json::from_value(json!({
        "name": "local",
        "endpoint": "stdio"
    }))
    .expect("mcp params should decode");
    assert_eq!(mcp.tools, Vec::<String>::new());
    assert!(mcp.enabled);

    let history: HistoryListParams =
        serde_json::from_value(json!({})).expect("history params should decode");
    let search: RunSearchParams =
        serde_json::from_value(json!({ "query": "abc" })).expect("search params should decode");
    assert_eq!(history.limit, 50);
    assert_eq!(search.limit, 10);

    let diff: GitReviewDiffParams =
        serde_json::from_value(json!({})).expect("git diff params should decode");
    assert_eq!(diff.scope, GitReviewScope::Uncommitted);
    assert_eq!(
        serde_json::to_value(diff.scope).unwrap(),
        json!("uncommitted")
    );
    assert_eq!(
        serde_json::to_value(GitReviewScope::AllBranchChanges).unwrap(),
        json!("allBranchChanges")
    );
    assert_eq!(
        serde_json::to_value(GitReviewScope::LastTurn).unwrap(),
        json!("lastTurn")
    );
    assert_eq!(
        serde_json::to_value(GitReviewPullRequestAction::RequestChanges).unwrap(),
        json!("requestChanges")
    );
}

#[test]
fn automation_create_params_default_to_enabled_local_targets() {
    let channel: ChannelAddParams =
        serde_json::from_value(json!({ "name": "alerts" })).expect("channel should decode");
    assert_eq!(channel.kind, "local");
    assert!(channel.enabled);
    assert_eq!(channel.target_session_id, None);

    let schedule: ScheduleAddParams = serde_json::from_value(json!({
        "name": "daily",
        "prompt": "summarize",
        "cadence": "daily"
    }))
    .expect("schedule should decode");
    assert!(schedule.enabled);
    assert_eq!(schedule.target_session_id, None);

    let push: ChannelPushParams = serde_json::from_value(json!({
        "channelId": "channel_1",
        "message": "hello"
    }))
    .expect("channel push should decode");
    assert!(!push.dispatch);
}

#[test]
fn local_settings_defaults_missing_feature_flags_to_enabled() {
    let settings: LocalSettings = serde_json::from_value(json!({
        "theme": "system",
        "telemetryEnabled": false,
        "telemetryDsn": "",
        "telemetryEnvironment": "local",
        "loggingLevel": "info",
        "loggingFormat": "pretty"
    }))
    .expect("settings should decode");

    assert!(settings.memory_enabled);
    assert!(settings.web_search_enabled);
    assert!(settings.code_execution_enabled);
    assert!(settings.trust_layer_enabled);
    assert!(settings.notifications_enabled);
}

#[test]
fn workflow_records_default_missing_runtime_collections() {
    let workflow: WorkflowDefinitionRecord = serde_json::from_value(json!({
        "workflowId": "workflow_1",
        "name": "Review",
        "version": "1",
        "visibility": "project",
        "createdAt": 1,
        "updatedAt": 2
    }))
    .expect("workflow should decode");
    assert_eq!(workflow.description, None);
    assert_eq!(workflow.args_schema, None);
    assert!(workflow.budget.is_none());
    assert_eq!(workflow.phases.len(), 0);
    assert_eq!(workflow.output_schema, None);
    assert_eq!(workflow.tags, Vec::<String>::new());

    let run: WorkflowRunRecord = serde_json::from_value(json!({
        "runId": "workflow_run_1",
        "workflowId": "workflow_1",
        "workflowVersion": "1",
        "state": "queued",
        "createdAt": 1,
        "updatedAt": 2
    }))
    .expect("workflow run should decode");
    assert_eq!(run.args, Value::Null);
    assert_eq!(run.phase_runs.len(), 0);
    assert_eq!(run.agent_run_ids, Vec::<String>::new());
    assert_eq!(run.output, None);
    assert_eq!(run.error, None);

    let params: WorkflowRunParams = serde_json::from_value(json!({ "workflowId": "workflow_1" }))
        .expect("workflow run params should decode");
    assert_eq!(params.args, Value::Null);
}

#[test]
fn sync_params_default_missing_batches_to_empty() {
    let push: SyncPushParams = serde_json::from_value(json!({})).expect("push should decode");
    assert_eq!(push.conversations.len(), 0);
    assert_eq!(push.messages.len(), 0);
    assert_eq!(push.deletions.len(), 0);
    assert_eq!(push.new_version, None);

    let desktop_push: DesktopSyncPushParams =
        serde_json::from_value(json!({ "deviceId": "device_1" }))
            .expect("desktop push should decode");
    assert_eq!(desktop_push.conversations.len(), 0);
    assert_eq!(desktop_push.messages.len(), 0);
    assert_eq!(desktop_push.deletions.len(), 0);

    let realtime: SyncRealtimePollParams =
        serde_json::from_value(json!({})).expect("realtime poll should decode");
    assert_eq!(realtime.last_event_id, None);
}

#[test]
fn sync_records_decode_legacy_minimal_payloads() {
    let conversation: ConversationRecord = serde_json::from_value(json!({
        "conversationId": "conv_1",
        "title": "Hello",
        "createdAt": 1,
        "updatedAt": 2,
        "lastMessagePreview": null
    }))
    .expect("conversation should decode");
    assert_eq!(conversation.id, None);
    assert_eq!(conversation.sync_version, 0);
    assert!(!conversation.is_deleted);

    let message: MessageRecord = serde_json::from_value(json!({
        "messageId": "msg_1",
        "conversationId": "conv_1",
        "role": "user",
        "content": "Hello",
        "createdAt": 1,
        "updatedAt": 2
    }))
    .expect("message should decode");
    assert!(!message.is_streaming);
    assert_eq!(message.sources, Vec::<Value>::new());
    assert_eq!(message.trace_id, None);

    let queued: PromptQueueRecord = serde_json::from_value(json!({
        "id": 1,
        "conversationId": "conv_1",
        "prompt": "next",
        "status": "queued",
        "createdAt": 1,
        "updatedAt": 2,
        "modelId": null
    }))
    .expect("queued prompt should decode");
    assert_eq!(queued.dispatch_timing, "immediate");
    assert_eq!(queued.reasoning_effort, None);
    assert_eq!(queued.attachment_ids, Vec::<String>::new());
}

#[test]
fn conversation_serialization_omits_only_unarchived_false_flag() {
    let mut conversation = ConversationRecord {
        id: Some(1),
        conversation_id: "conv_1".to_string(),
        title: "Hello".to_string(),
        created_at: 1,
        updated_at: 2,
        last_message_preview: None,
        project_id: Some(7),
        sync_version: 3,
        last_synced_at: 4,
        device_id: Some("device_1".to_string()),
        is_deleted: false,
        is_archived: false,
    };

    let unarchived = serde_json::to_value(&conversation).expect("conversation should encode");
    assert_eq!(unarchived.get("isArchived"), None);
    assert_eq!(unarchived["projectId"], json!(7));

    conversation.is_archived = true;
    let archived = serde_json::to_value(conversation).expect("conversation should encode");
    assert_eq!(archived["isArchived"], json!(true));
}

#[test]
fn pending_change_uses_type_wire_field() {
    let change = PendingChangeRecord {
        id: None,
        change_type: "message".to_string(),
        entity_id: "msg_1".to_string(),
        operation: "upsert".to_string(),
        data: json!({ "content": "hello" }),
        created_at: 1,
    };

    assert_eq!(
        serde_json::to_value(change).expect("pending change should encode"),
        json!({
            "id": null,
            "type": "message",
            "entityId": "msg_1",
            "operation": "upsert",
            "data": { "content": "hello" },
            "createdAt": 1
        })
    );
}

#[test]
fn desktop_sync_results_intentionally_use_snake_case() {
    let pull = DesktopSyncPullResult {
        conversations: Vec::new(),
        messages: Vec::new(),
        deletions: Vec::new(),
        latest_version: 12,
        has_more: Some(false),
    };
    let push = DesktopSyncPushResult {
        accepted: vec!["conv_1".to_string()],
        conflicts: Vec::new(),
        new_version: 13,
        conversation_id_mappings: json!({ "local": "remote" }),
    };

    assert_eq!(
        serde_json::to_value(pull).expect("desktop pull should encode"),
        json!({
            "conversations": [],
            "messages": [],
            "deletions": [],
            "latest_version": 12,
            "has_more": false
        })
    );
    assert_eq!(
        serde_json::to_value(push).expect("desktop push should encode"),
        json!({
            "accepted": ["conv_1"],
            "conflicts": [],
            "new_version": 13,
            "conversation_id_mappings": { "local": "remote" }
        })
    );
}

#[test]
fn enum_wire_values_are_stable() {
    assert_eq!(
        serde_json::to_value(RunStatus::Canceled).expect("run status should encode"),
        json!("canceled")
    );
    assert_eq!(
        serde_json::to_value(WorkflowRunState::Cancelled).expect("workflow state should encode"),
        json!("cancelled")
    );
    assert_eq!(
        serde_json::to_value(WorkflowRunState::WaitingForApproval)
            .expect("workflow state should encode"),
        json!("waiting_for_approval")
    );
    assert_eq!(
        serde_json::to_value(WorkflowVisibility::Organization)
            .expect("workflow visibility should encode"),
        json!("organization")
    );
    assert_eq!(
        serde_json::to_value(WorkflowPhaseKind::Fanout).expect("phase kind should encode"),
        json!("fanout")
    );
}

#[test]
fn tagged_events_keep_client_facing_type_names() {
    assert_eq!(
        serde_json::to_value(AppServerEvent::RunUpdated {
            run: Box::new(sample_run())
        })
        .expect("run event should encode"),
        json!({
            "type": "run_updated",
            "run": {
                "id": "run_123",
                "prompt": "ship it",
                "modelId": "model-a",
                "projectId": 42,
                "status": "processing",
                "output": null,
                "error": null,
                "createdAt": 10,
                "updatedAt": 11
            }
        })
    );

    assert_eq!(
        serde_json::to_value(AppServerEvent::TurnStarted {
            thread_id: "thread_1".to_string(),
            turn: Box::new(sample_turn()),
        })
        .expect("turn event should encode")["type"],
        json!("turn_started")
    );
}

#[test]
fn ollama_pull_event_uses_tagged_camel_case_payloads() {
    let progress = OllamaPullEventRecord::Progress {
        digest: Some("sha256:abc".to_string()),
        completed: Some(1),
        total: Some(2),
    };

    assert_eq!(
        serde_json::to_value(progress).expect("ollama progress should encode"),
        json!({
            "type": "progress",
            "digest": "sha256:abc",
            "completed": 1,
            "total": 2
        })
    );
    assert_eq!(
        serde_json::to_value(OllamaPullEventRecord::Success).expect("ollama success should encode"),
        json!({ "type": "success" })
    );
}
