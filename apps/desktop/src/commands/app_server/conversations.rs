use taskforceai_app_protocol::{
    ConversationIDParams, ConversationListParams, ConversationListResult, ConversationRecord,
    ConversationReplaceIDParams, MessageIDParams, MessageListResult, MessageRecord,
};

use super::call_app_server;
use crate::state::AppState;

fn missing_record_error(method: &str, field: &str) -> taskforceai_app_client::AppClientError {
    taskforceai_app_client::AppClientError::Rpc {
        code: -32603,
        message: format!("{method} succeeded without {field} in the response"),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_conversation_list(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<ConversationListResult, String> {
    call_app_server(state, "conversation_list", |client| {
        Box::pin(async move {
            client
                .conversation_list(conversation_list_params(limit))
                .await
        })
    })
    .await
}

pub(super) fn conversation_list_params(limit: Option<usize>) -> ConversationListParams {
    ConversationListParams {
        limit: limit.unwrap_or(50),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_conversation_get(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) -> Result<Option<ConversationRecord>, String> {
    call_app_server(state, "conversation_get", |client| {
        Box::pin(async move {
            client
                .conversation_get(ConversationIDParams { conversation_id })
                .await
                .map(|result| result.conversation)
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state, conversation), err)]
pub async fn app_server_conversation_upsert(
    state: tauri::State<'_, AppState>,
    conversation: ConversationRecord,
) -> Result<ConversationRecord, String> {
    call_app_server(state, "conversation_upsert", |client| {
        Box::pin(async move {
            client
                .conversation_upsert(conversation)
                .await
                .and_then(|result| {
                    result
                        .conversation
                        .ok_or_else(|| missing_record_error("conversation_upsert", "conversation"))
                })
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_conversation_delete_all(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    call_app_server(state, "conversation_delete_all", |client| {
        Box::pin(async move { client.conversation_delete_all().await.map(|_| ()) })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_conversation_replace_id(
    state: tauri::State<'_, AppState>,
    old_id: String,
    new_id: String,
) -> Result<(), String> {
    call_app_server(state, "conversation_replace_id", |client| {
        Box::pin(async move {
            client
                .conversation_replace_id(conversation_replace_id_params(old_id, new_id))
                .await
                .map(|_| ())
        })
    })
    .await
}

pub(super) fn conversation_replace_id_params(
    old_id: String,
    new_id: String,
) -> ConversationReplaceIDParams {
    ConversationReplaceIDParams {
        old_conversation_id: old_id,
        new_conversation_id: new_id,
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_message_list(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) -> Result<MessageListResult, String> {
    call_app_server(state, "message_list", |client| {
        Box::pin(async move {
            client
                .message_list(ConversationIDParams { conversation_id })
                .await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_message_get(
    state: tauri::State<'_, AppState>,
    message_id: String,
) -> Result<Option<MessageRecord>, String> {
    call_app_server(state, "message_get", |client| {
        Box::pin(async move {
            client
                .message_get(MessageIDParams { message_id })
                .await
                .map(|result| result.message)
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state, message), err)]
pub async fn app_server_message_upsert(
    state: tauri::State<'_, AppState>,
    message: MessageRecord,
) -> Result<MessageRecord, String> {
    call_app_server(state, "message_upsert", |client| {
        Box::pin(async move {
            client.message_upsert(message).await.and_then(|result| {
                result
                    .message
                    .ok_or_else(|| missing_record_error("message_upsert", "message"))
            })
        })
    })
    .await
}
