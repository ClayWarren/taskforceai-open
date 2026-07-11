use taskforceai_app_protocol::{
    HistoryListParams, HistoryListResult, PendingChangeIDParams, PendingChangeRecord,
    PendingChangeUpdateDataParams,
};

use super::call_app_server;
use crate::state::AppState;

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_history_list(
    state: tauri::State<'_, AppState>,
    limit: Option<usize>,
) -> Result<HistoryListResult, String> {
    call_app_server(state, "history_list", |client| {
        Box::pin(async move { client.history_list(history_list_params(limit)).await })
    })
    .await
}

pub(super) fn history_list_params(limit: Option<usize>) -> HistoryListParams {
    HistoryListParams {
        limit: limit.unwrap_or(50),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state, change), err)]
pub async fn app_server_pending_change_add(
    state: tauri::State<'_, AppState>,
    change: PendingChangeRecord,
) -> Result<PendingChangeRecord, String> {
    call_app_server(state, "pending_change_add", |client| {
        Box::pin(async move {
            client
                .pending_change_add(change)
                .await
                .map(|result| result.pending_change)
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state, data), err)]
pub async fn app_server_pending_change_update_data(
    state: tauri::State<'_, AppState>,
    id: i64,
    data: serde_json::Value,
) -> Result<(), String> {
    call_app_server(state, "pending_change_update_data", |client| {
        Box::pin(async move {
            client
                .pending_change_update_data(pending_change_update_data_params(id, data))
                .await
                .map(|_| ())
        })
    })
    .await
}

pub(super) fn pending_change_update_data_params(
    id: i64,
    data: serde_json::Value,
) -> PendingChangeUpdateDataParams {
    PendingChangeUpdateDataParams { id, data }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_pending_change_delete(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    call_app_server(state, "pending_change_delete", |client| {
        Box::pin(async move {
            client
                .pending_change_delete(PendingChangeIDParams { id })
                .await
                .map(|_| ())
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_pending_change_clear(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    call_app_server(state, "pending_change_clear", |client| {
        Box::pin(async move { client.pending_change_clear().await.map(|_| ()) })
    })
    .await
}
