use serde_json::{json, Value};

use crate::protocol::{
    ConversationRecord, MessageRecord, PendingChangeRecord, PendingPromptRecord, PromptQueueRecord,
};
use crate::store::SqliteRunStore;

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
        }
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
        conversation_record_from_sync_value, conversation_sync_value,
        desktop_conversation_sync_value,
    };
    use crate::protocol::ConversationRecord;

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
}
