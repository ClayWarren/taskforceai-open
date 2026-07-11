use serde_json::{json, Value};

use crate::protocol::{
    ConversationRecord, MessageRecord, PendingChangeRecord, PendingPromptRecord, PromptQueueRecord,
};
use taskforceai_app_store::SqliteRunStore;

use super::RuntimeError;

pub(crate) fn merge_json_records(
    mut existing: Vec<Value>,
    updates: Vec<Value>,
    key: &str,
) -> Vec<Value> {
    for update in updates {
        let duplicate = update
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| {
                existing
                    .iter()
                    .any(|item| item.get(key).and_then(Value::as_str) == Some(value))
            });
        if !duplicate {
            existing.push(update);
        }
    }
    existing
}

pub(crate) fn title_from_prompt(prompt: &str) -> String {
    let title = prompt
        .split_whitespace()
        .take(8)
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        "Untitled conversation".to_string()
    } else {
        title
    }
}

pub(crate) fn conversation_sync_value(conversation: &ConversationRecord) -> Value {
    json!({
        "localId": conversation.conversation_id,
        "userInput": conversation.title,
        "result": conversation.last_message_preview,
        "timestamp": conversation.created_at.to_string(),
        "updatedAt": conversation.updated_at.to_string(),
        "syncVersion": conversation.sync_version,
        "lastSyncedAt": conversation.last_synced_at.to_string(),
        "deviceId": conversation.device_id,
        "isDeleted": conversation.is_deleted,
        "isArchived": conversation.is_archived,
    })
}

pub(crate) fn message_sync_value(message: &MessageRecord) -> Value {
    json!({
        "messageId": message.message_id,
        "conversationLocalId": message.conversation_id,
        "role": message.role,
        "content": message.content,
        "isStreaming": message.is_streaming,
        "isAgentStatus": message.is_agent_status,
        "isLocalCommandOutput": message.is_local_command_output,
        "elapsedSeconds": message.elapsed_seconds,
        "createdAt": message.created_at.to_string(),
        "updatedAt": message.updated_at.to_string(),
        "error": message.error,
        "sources": message.sources,
        "toolEvents": message.tool_events,
        "agentStatuses": message.agent_statuses,
        "traceId": message.trace_id,
        "syncVersion": message.sync_version,
        "lastSyncedAt": message.last_synced_at.to_string(),
        "deviceId": message.device_id,
        "isDeleted": message.is_deleted,
    })
}

pub(crate) fn desktop_conversation_sync_value(conversation: &ConversationRecord) -> Value {
    let remote_id = conversation.conversation_id.parse::<i64>().ok();
    json!({
        "id": remote_id,
        "local_id": if remote_id.is_none() { Some(conversation.conversation_id.as_str()) } else { None },
        "timestamp": conversation.created_at.to_string(),
        "user_input": conversation.title,
        "result": conversation.last_message_preview,
        "sync_version": conversation.sync_version,
        "last_synced_at": conversation.last_synced_at.to_string(),
        "device_id": conversation.device_id,
        "is_deleted": conversation.is_deleted,
        "is_archived": conversation.is_archived,
        "updated_at": conversation.updated_at.to_string(),
    })
}

pub(crate) fn desktop_message_sync_value(message: &MessageRecord) -> Value {
    let remote_conversation_id = message.conversation_id.parse::<i64>().ok();
    json!({
        "message_id": message.message_id,
        "conversation_id": remote_conversation_id.unwrap_or_default(),
        "conversation_local_id": if remote_conversation_id.is_none() { Some(message.conversation_id.as_str()) } else { None },
        "role": message.role,
        "content": message.content,
        "is_streaming": message.is_streaming,
        "is_agent_status": message.is_agent_status,
        "is_local_command_output": message.is_local_command_output,
        "elapsed_seconds": message.elapsed_seconds,
        "created_at": message.created_at.to_string(),
        "updated_at": message.updated_at.to_string(),
        "error": message.error,
        "sources": message.sources,
        "tool_events": message.tool_events,
        "agent_statuses": message.agent_statuses,
        "sync_version": message.sync_version,
        "last_synced_at": message.last_synced_at.to_string(),
        "device_id": message.device_id,
        "is_deleted": message.is_deleted,
    })
}

pub(crate) fn conversation_record_from_sync_value(
    value: Value,
) -> Result<ConversationRecord, RuntimeError> {
    let id = string_field(&value, "localId")
        .or_else(|| string_field(&value, "local_id"))
        .or_else(|| string_field(&value, "conversationId"))
        .or_else(|| number_field(&value, "id").map(|id| id.to_string()))
        .ok_or_else(|| RuntimeError::storage("sync conversation is missing localId"))?;
    let title = string_field(&value, "userInput")
        .or_else(|| string_field(&value, "user_input"))
        .or_else(|| string_field(&value, "title"))
        .unwrap_or_else(|| "Untitled conversation".to_string());
    Ok(ConversationRecord {
        conversation_id: id,
        title,
        created_at: millis_field(&value, "timestamp").unwrap_or_default(),
        updated_at: millis_field(&value, "updatedAt")
            .or_else(|| millis_field(&value, "updated_at"))
            .unwrap_or_default(),
        last_message_preview: string_field(&value, "result"),
        sync_version: number_field(&value, "syncVersion")
            .or_else(|| number_field(&value, "sync_version"))
            .unwrap_or_default(),
        last_synced_at: number_field(&value, "lastSyncedAt")
            .or_else(|| number_field(&value, "last_synced_at"))
            .unwrap_or_default(),
        device_id: string_field(&value, "deviceId").or_else(|| string_field(&value, "device_id")),
        is_deleted: bool_field(&value, "isDeleted") || bool_field(&value, "is_deleted"),
        is_archived: bool_field(&value, "isArchived") || bool_field(&value, "is_archived"),
        ..ConversationRecord::default()
    })
}

pub(crate) fn message_record_from_sync_value(value: Value) -> Result<MessageRecord, RuntimeError> {
    let message_id = string_field(&value, "messageId")
        .or_else(|| string_field(&value, "message_id"))
        .ok_or_else(|| RuntimeError::storage("sync message is missing messageId"))?;
    let conversation_id = string_field(&value, "conversationLocalId")
        .or_else(|| string_field(&value, "conversation_local_id"))
        .or_else(|| string_field(&value, "conversationId"))
        .or_else(|| string_field(&value, "conversation_id"))
        .or_else(|| number_field(&value, "conversationId").map(|id| id.to_string()))
        .or_else(|| number_field(&value, "conversation_id").map(|id| id.to_string()))
        .ok_or_else(|| RuntimeError::storage("sync message is missing conversation id"))?;
    Ok(MessageRecord {
        message_id,
        conversation_id,
        role: string_field(&value, "role").unwrap_or_else(|| "assistant".to_string()),
        content: string_field(&value, "content").unwrap_or_default(),
        is_streaming: bool_field(&value, "isStreaming") || bool_field(&value, "is_streaming"),
        is_agent_status: bool_field(&value, "isAgentStatus")
            || bool_field(&value, "is_agent_status"),
        is_local_command_output: bool_field(&value, "isLocalCommandOutput")
            || bool_field(&value, "is_local_command_output"),
        elapsed_seconds: number_f64_field(&value, "elapsedSeconds")
            .or_else(|| number_f64_field(&value, "elapsed_seconds")),
        created_at: millis_field(&value, "createdAt")
            .or_else(|| millis_field(&value, "created_at"))
            .unwrap_or_default(),
        updated_at: millis_field(&value, "updatedAt")
            .or_else(|| millis_field(&value, "updated_at"))
            .unwrap_or_default(),
        error: string_field(&value, "error"),
        sources: array_field(&value, "sources"),
        tool_events: array_field(&value, "toolEvents")
            .into_iter()
            .chain(array_field(&value, "tool_events"))
            .collect(),
        agent_statuses: array_field(&value, "agentStatuses")
            .into_iter()
            .chain(array_field(&value, "agent_statuses"))
            .collect(),
        trace_id: string_field(&value, "traceId").or_else(|| string_field(&value, "trace_id")),
        sync_version: number_field(&value, "syncVersion")
            .or_else(|| number_field(&value, "sync_version"))
            .unwrap_or_default(),
        last_synced_at: number_field(&value, "lastSyncedAt")
            .or_else(|| number_field(&value, "last_synced_at"))
            .unwrap_or_default(),
        device_id: string_field(&value, "deviceId").or_else(|| string_field(&value, "device_id")),
        is_deleted: bool_field(&value, "isDeleted") || bool_field(&value, "is_deleted"),
        ..MessageRecord::default()
    })
}

pub(crate) fn apply_sync_deletion(
    store: &SqliteRunStore,
    value: &Value,
) -> Result<(), RuntimeError> {
    let deletion_type = string_field(value, "type")
        .or_else(|| string_field(value, "entityType"))
        .or_else(|| string_field(value, "entity_type"))
        .map(|value| value.to_ascii_lowercase());
    if deletion_type
        .as_deref()
        .is_some_and(|value| value.contains("message"))
    {
        if let Some(id) = sync_deletion_id(
            value,
            &["messageId", "message_id", "entityId", "entity_id", "id"],
        ) {
            store.delete_message(&id)?;
        }
        return Ok(());
    }
    if deletion_type
        .as_deref()
        .is_some_and(|value| value.contains("conversation"))
    {
        if let Some(id) = sync_deletion_id(
            value,
            &[
                "conversationId",
                "conversation_id",
                "conversationLocalId",
                "conversation_local_id",
                "localId",
                "local_id",
                "entityId",
                "entity_id",
                "id",
            ],
        ) {
            store.delete_conversation(&id)?;
        } // coverage:ignore-line
        return Ok(());
    }
    if let Some(id) = sync_deletion_id(value, &["messageId", "message_id"]) {
        store.delete_message(&id)?;
    } else if let Some(id) = sync_deletion_id(
        value,
        &[
            "conversationId",
            "conversation_id",
            "conversationLocalId",
            "conversation_local_id",
            "localId",
            "local_id",
        ],
    ) {
        store.delete_conversation(&id)?;
    }
    Ok(())
}

pub(crate) fn sync_deletion_id(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        string_field(value, key).or_else(|| number_field(value, key).map(|id| id.to_string()))
    })
}

pub(crate) fn validate_conversation_record(
    conversation: &ConversationRecord,
) -> Result<(), RuntimeError> {
    if conversation.conversation_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("conversationId is required"));
    }
    if conversation.title.trim().is_empty() {
        return Err(RuntimeError::invalid_params("title is required"));
    }
    Ok(())
}

pub(crate) fn validate_message_record(message: &MessageRecord) -> Result<(), RuntimeError> {
    if message.message_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("messageId is required"));
    }
    if message.conversation_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("conversationId is required"));
    }
    if message.role.trim().is_empty() {
        return Err(RuntimeError::invalid_params("role is required"));
    }
    Ok(())
}

pub(crate) fn validate_pending_change_record(
    change: &PendingChangeRecord,
) -> Result<(), RuntimeError> {
    match change.change_type.as_str() {
        "conversation" | "message" => {}
        _ => {
            return Err(RuntimeError::invalid_params(
                "type must be conversation or message",
            ));
        }
    }
    if change.entity_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("entityId is required"));
    }
    match change.operation.as_str() {
        "create" | "update" | "delete" => Ok(()),
        _ => Err(RuntimeError::invalid_params(
            "operation must be create, update, or delete",
        )),
    }
}

pub(crate) fn validate_pending_prompt_record(
    prompt: &PendingPromptRecord,
) -> Result<(), RuntimeError> {
    if prompt.id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("id is required"));
    }
    if prompt.prompt.trim().is_empty() {
        return Err(RuntimeError::invalid_params("prompt is required"));
    }
    Ok(())
}

pub(crate) fn validate_prompt_queue_record(prompt: &PromptQueueRecord) -> Result<(), RuntimeError> {
    if prompt.conversation_id.trim().is_empty() {
        return Err(RuntimeError::invalid_params("conversationId is required"));
    }
    if prompt.prompt.trim().is_empty() {
        return Err(RuntimeError::invalid_params("prompt is required"));
    }
    match prompt.dispatch_timing.as_str() {
        "immediate" | "after_response" => {}
        _ => {
            return Err(RuntimeError::invalid_params(
                "dispatchTiming must be immediate or after_response",
            ));
        }
    }
    Ok(())
}

pub(crate) fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn number_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

pub(crate) fn number_f64_field(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

pub(crate) fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) fn array_field(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub(crate) fn millis_field(value: &Value, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        apply_sync_deletion, array_field, bool_field, conversation_record_from_sync_value,
        conversation_sync_value, desktop_conversation_sync_value, desktop_message_sync_value,
        merge_json_records, message_record_from_sync_value, message_sync_value, millis_field,
        number_f64_field, number_field, string_field, sync_deletion_id, title_from_prompt,
        validate_conversation_record, validate_message_record, validate_pending_change_record,
        validate_pending_prompt_record, validate_prompt_queue_record,
    };
    use crate::protocol::{
        ConversationRecord, MessageRecord, PendingChangeRecord, PendingPromptRecord,
        PendingPromptStatus, PromptQueueRecord,
    };
    use taskforceai_app_store::SqliteRunStore;

    #[test]
    fn conversation_sync_serializers_preserve_archive_state() {
        let record = ConversationRecord {
            conversation_id: "local-archived".to_string(),
            title: "Archived conversation".to_string(),
            is_archived: true,
            ..ConversationRecord::default()
        };

        let app_value = conversation_sync_value(&record);
        let desktop_value = desktop_conversation_sync_value(&record);

        assert_eq!(app_value["isArchived"], json!(true));
        assert_eq!(desktop_value["is_archived"], json!(true));
    }

    #[test]
    fn conversation_record_from_sync_value_reads_archive_aliases() {
        let camel = conversation_record_from_sync_value(json!({
            "localId": "local-camel",
            "userInput": "Archived camel",
            "isArchived": true
        }))
        .expect("camel archive field should parse");
        let snake = conversation_record_from_sync_value(json!({
            "local_id": "local-snake",
            "user_input": "Archived snake",
            "is_archived": true
        }))
        .expect("snake archive field should parse");

        assert!(camel.is_archived);
        assert!(snake.is_archived);
    }

    #[test]
    fn record_merge_title_and_field_helpers_cover_empty_and_alias_paths() {
        let merged = merge_json_records(
            vec![json!({ "id": "one", "value": 1 })],
            vec![
                json!({ "id": "one", "value": "duplicate" }),
                json!({ "id": "two", "value": 2 }),
                json!({ "value": "missing id" }),
            ],
            "id",
        );
        assert_eq!(merged.len(), 3);
        assert_eq!(title_from_prompt(""), "Untitled conversation");
        assert_eq!(
            title_from_prompt("one two three four five six seven eight nine"),
            "one two three four five six seven eight"
        );

        let value = json!({
            "text": "  value  ",
            "blank": "   ",
            "int": 42,
            "float": 1.5,
            "flag": true,
            "items": [{ "id": 1 }],
            "millis": "123",
            "millis_number": 456
        });
        assert_eq!(string_field(&value, "text").as_deref(), Some("value"));
        assert_eq!(string_field(&value, "blank"), None);
        assert_eq!(number_field(&value, "int"), Some(42));
        assert_eq!(number_f64_field(&value, "float"), Some(1.5));
        assert!(bool_field(&value, "flag"));
        assert_eq!(array_field(&value, "items"), vec![json!({ "id": 1 })]);
        assert_eq!(
            array_field(&value, "missing"),
            Vec::<serde_json::Value>::new()
        );
        assert_eq!(millis_field(&value, "millis"), Some(123));
        assert_eq!(millis_field(&value, "millis_number"), Some(456));
        assert_eq!(
            millis_field(&json!({ "millis": "not-a-number" }), "millis"),
            None
        );
    }

    #[test]
    fn message_sync_serializers_and_parsers_cover_camel_snake_and_numeric_ids() {
        let message = MessageRecord {
            message_id: "msg-1".to_string(),
            conversation_id: "conv-local".to_string(),
            role: "assistant".to_string(),
            content: "hello".to_string(),
            is_streaming: true,
            is_agent_status: true,
            is_local_command_output: true,
            elapsed_seconds: Some(2.5),
            created_at: 10,
            updated_at: 20,
            error: Some("none".to_string()),
            sources: vec![json!({ "url": "https://example.com" })],
            tool_events: vec![json!({ "type": "tool" })],
            agent_statuses: vec![json!({ "agent": "ready" })],
            trace_id: Some("trace-1".to_string()),
            sync_version: 7,
            last_synced_at: 8,
            device_id: Some("device-1".to_string()),
            is_deleted: true,
            ..MessageRecord::default()
        };

        let app_value = message_sync_value(&message);
        assert_eq!(app_value["conversationLocalId"], json!("conv-local"));
        assert_eq!(app_value["toolEvents"], json!([{ "type": "tool" }]));

        let desktop_value = desktop_message_sync_value(&message);
        assert_eq!(desktop_value["conversation_id"], json!(0));
        assert_eq!(desktop_value["conversation_local_id"], json!("conv-local"));

        let numeric = MessageRecord {
            conversation_id: "42".to_string(),
            ..message.clone()
        };
        let desktop_numeric = desktop_message_sync_value(&numeric);
        assert_eq!(desktop_numeric["conversation_id"], json!(42));
        assert!(desktop_numeric["conversation_local_id"].is_null());

        let parsed = message_record_from_sync_value(json!({
            "messageId": "msg-camel",
            "conversationId": 42,
            "role": "user",
            "content": "camel",
            "isStreaming": true,
            "isAgentStatus": true,
            "isLocalCommandOutput": true,
            "elapsedSeconds": 3.25,
            "createdAt": "100",
            "updatedAt": 101,
            "error": "err",
            "sources": [{ "source": 1 }],
            "toolEvents": [{ "tool": 1 }],
            "agentStatuses": [{ "agent": 1 }],
            "traceId": "trace-camel",
            "syncVersion": 9,
            "lastSyncedAt": 10,
            "deviceId": "device-camel",
            "isDeleted": true
        }))
        .expect("camel message should parse");
        assert_eq!(parsed.conversation_id, "42");
        assert_eq!(parsed.elapsed_seconds, Some(3.25));
        assert_eq!(parsed.trace_id.as_deref(), Some("trace-camel"));
        assert!(parsed.is_local_command_output);

        let parsed = message_record_from_sync_value(json!({
            "message_id": "msg-snake",
            "conversation_id": "conv-snake",
            "is_streaming": true,
            "is_agent_status": true,
            "is_local_command_output": true,
            "elapsed_seconds": 1.25,
            "created_at": 200,
            "updated_at": "201",
            "tool_events": [{ "tool": 2 }],
            "agent_statuses": [{ "agent": 2 }],
            "trace_id": "trace-snake",
            "sync_version": 11,
            "last_synced_at": 12,
            "device_id": "device-snake",
            "is_deleted": true
        }))
        .expect("snake message should parse");
        assert_eq!(parsed.role, "assistant");
        assert_eq!(parsed.content, "");
        assert_eq!(parsed.tool_events, vec![json!({ "tool": 2 })]);
        assert_eq!(parsed.agent_statuses, vec![json!({ "agent": 2 })]);

        assert!(message_record_from_sync_value(json!({ "conversationId": "conv" })).is_err());
        assert!(message_record_from_sync_value(json!({ "messageId": "msg" })).is_err());
    }

    #[test]
    fn conversation_parser_covers_title_id_and_timestamp_fallbacks() {
        let from_numeric_id = conversation_record_from_sync_value(json!({
            "id": 77,
            "title": "Remote title",
            "timestamp": "1000",
            "updated_at": 2000,
            "result": "preview",
            "sync_version": 3,
            "last_synced_at": 4,
            "device_id": "device",
            "is_deleted": true
        }))
        .expect("numeric id conversation should parse");

        assert_eq!(from_numeric_id.conversation_id, "77");
        assert_eq!(from_numeric_id.title, "Remote title");
        assert_eq!(from_numeric_id.created_at, 1000);
        assert_eq!(from_numeric_id.updated_at, 2000);
        assert_eq!(
            from_numeric_id.last_message_preview.as_deref(),
            Some("preview")
        );
        assert!(from_numeric_id.is_deleted);

        let untitled = conversation_record_from_sync_value(json!({
            "conversationId": "conv-id"
        }))
        .expect("conversation id alias should parse");
        assert_eq!(untitled.title, "Untitled conversation");

        assert!(conversation_record_from_sync_value(json!({ "title": "missing id" })).is_err());
    }

    #[test]
    fn validation_helpers_reject_missing_required_fields_and_bad_enums() {
        assert!(validate_conversation_record(&ConversationRecord {
            conversation_id: "conv".to_string(),
            title: "Title".to_string(),
            ..ConversationRecord::default()
        })
        .is_ok());
        assert!(validate_conversation_record(&ConversationRecord {
            title: "Title".to_string(),
            ..ConversationRecord::default()
        })
        .is_err());
        assert!(validate_conversation_record(&ConversationRecord {
            conversation_id: "conv".to_string(),
            ..ConversationRecord::default()
        })
        .is_err());

        assert!(validate_message_record(&MessageRecord {
            message_id: "msg".to_string(),
            conversation_id: "conv".to_string(),
            role: "assistant".to_string(),
            ..MessageRecord::default()
        })
        .is_ok());
        assert!(validate_message_record(&MessageRecord {
            conversation_id: "conv".to_string(),
            role: "assistant".to_string(),
            ..MessageRecord::default()
        })
        .is_err());
        assert!(validate_message_record(&MessageRecord {
            message_id: "msg".to_string(),
            role: "assistant".to_string(),
            ..MessageRecord::default()
        })
        .is_err());
        assert!(validate_message_record(&MessageRecord {
            message_id: "msg".to_string(),
            conversation_id: "conv".to_string(),
            ..MessageRecord::default()
        })
        .is_err());

        let valid_change = PendingChangeRecord {
            id: None,
            change_type: "conversation".to_string(),
            entity_id: "conv".to_string(),
            operation: "create".to_string(),
            data: json!({}),
            created_at: 1,
        };
        assert!(validate_pending_change_record(&valid_change).is_ok());
        assert!(validate_pending_change_record(&PendingChangeRecord {
            change_type: "workspace".to_string(),
            ..valid_change.clone()
        })
        .is_err());
        assert!(validate_pending_change_record(&PendingChangeRecord {
            entity_id: " ".to_string(),
            ..valid_change.clone()
        })
        .is_err());
        assert!(validate_pending_change_record(&PendingChangeRecord {
            operation: "merge".to_string(),
            ..valid_change.clone()
        })
        .is_err());

        assert!(validate_pending_prompt_record(&PendingPromptRecord {
            id: "prompt-1".to_string(),
            prompt: "Draft".to_string(),
            model_id: None,
            reasoning_effort: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        })
        .is_ok());
        assert!(validate_pending_prompt_record(&PendingPromptRecord {
            id: " ".to_string(),
            prompt: "Draft".to_string(),
            model_id: None,
            reasoning_effort: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        })
        .is_err());
        assert!(validate_pending_prompt_record(&PendingPromptRecord {
            id: "prompt-1".to_string(),
            prompt: " ".to_string(),
            model_id: None,
            reasoning_effort: None,
            project_id: None,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error: None,
            created_at: 1,
            updated_at: 1,
        })
        .is_err());

        let valid_queue = PromptQueueRecord {
            id: None,
            conversation_id: "conv".to_string(),
            prompt: "Draft".to_string(),
            status: "queued".to_string(),
            dispatch_timing: "immediate".to_string(),
            created_at: 1,
            updated_at: 1,
            model_id: None,
            reasoning_effort: None,
            attachment_ids: Vec::new(),
        };
        assert!(validate_prompt_queue_record(&valid_queue).is_ok());
        assert!(validate_prompt_queue_record(&PromptQueueRecord {
            dispatch_timing: "after_response".to_string(),
            ..valid_queue.clone()
        })
        .is_ok());
        assert!(validate_prompt_queue_record(&PromptQueueRecord {
            conversation_id: " ".to_string(),
            ..valid_queue.clone()
        })
        .is_err());
        assert!(validate_prompt_queue_record(&PromptQueueRecord {
            prompt: " ".to_string(),
            ..valid_queue.clone()
        })
        .is_err());
        assert!(validate_prompt_queue_record(&PromptQueueRecord {
            dispatch_timing: "later".to_string(),
            ..valid_queue
        })
        .is_err());
    }

    #[test]
    fn sync_deletion_helpers_delete_messages_and_conversations_by_alias() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-records-delete-{}-{}.sqlite",
            std::process::id(),
            std::thread::current().name().unwrap_or("thread")
        ));
        let _ = std::fs::remove_file(&path);
        let store = SqliteRunStore::new(path.clone());
        let conversation = ConversationRecord {
            conversation_id: "conv-delete".to_string(),
            title: "Delete me".to_string(),
            created_at: 1,
            updated_at: 1,
            ..ConversationRecord::default()
        };
        let message = MessageRecord {
            message_id: "msg-delete".to_string(),
            conversation_id: "conv-delete".to_string(),
            role: "user".to_string(),
            content: "remove".to_string(),
            created_at: 1,
            updated_at: 1,
            ..MessageRecord::default()
        };
        store.upsert_conversation(&conversation).unwrap();
        store.upsert_message(&message).unwrap();

        assert_eq!(
            sync_deletion_id(&json!({ "message_id": 123 }), &["message_id"]),
            Some("123".to_string())
        );
        apply_sync_deletion(
            &store,
            &json!({ "entityType": "message", "entityId": "msg-delete" }),
        )
        .unwrap();
        assert!(store.get_message("msg-delete").unwrap().is_none());

        store.upsert_message(&message).unwrap();
        apply_sync_deletion(
            &store,
            &json!({ "entity_type": "conversation", "local_id": "conv-delete" }),
        )
        .unwrap();
        assert!(store.get_conversation("conv-delete").unwrap().is_none());
        assert!(store.get_message("msg-delete").unwrap().is_none());

        store.upsert_conversation(&conversation).unwrap();
        store.upsert_message(&message).unwrap();
        apply_sync_deletion(&store, &json!({ "messageId": "msg-delete" })).unwrap();
        assert!(store.get_message("msg-delete").unwrap().is_none());

        store.upsert_message(&message).unwrap();
        apply_sync_deletion(&store, &json!({ "conversationId": "conv-delete" })).unwrap();
        assert!(store.get_conversation("conv-delete").unwrap().is_none());

        apply_sync_deletion(&store, &json!({ "entityType": "message" })).unwrap();
        apply_sync_deletion(&store, &json!({ "type": "unknown" })).unwrap();
        let _ = std::fs::remove_file(path);
    }
}
