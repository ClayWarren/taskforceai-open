use taskforceai_app_protocol::{
    AuthStatus, DesktopSyncPullParams, DesktopSyncPullResult, DesktopSyncPushParams,
    DesktopSyncPushResult, HybridModeResult, HybridModeSetParams, ModelListResult,
    ModelSelectParams, OllamaEnsureParams, OllamaEnsureResult, OllamaStatusParams,
    OllamaStatusResult, PluginListResult, PluginSetEnabledParams, QuickModeResult,
    QuickModeSetParams, RemoteSettingsResult, RemoteSettingsUpdateParams, RunModeSetParams,
    SyncConfigureParams, SyncStatusResult,
};

use super::call_app_server;
use crate::state::AppState;

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_auth_logout(
    state: tauri::State<'_, AppState>,
) -> Result<AuthStatus, String> {
    let native_state = state.inner().clone();
    let status = call_app_server(state, "auth_logout", |client| {
        Box::pin(async move { client.auth_logout().await })
    })
    .await?;
    native_state.sync_remote_keep_awake(false)?;
    Ok(status)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_remote_settings_get(
    state: tauri::State<'_, AppState>,
) -> Result<RemoteSettingsResult, String> {
    let native_state = state.inner().clone();
    let settings = call_app_server(state, "remote_settings_get", |client| {
        Box::pin(async move { client.remote_settings_get().await })
    })
    .await?;
    native_state.sync_remote_keep_awake(settings.allow_connections && settings.keep_awake)?;
    Ok(settings)
}

#[tauri::command]
#[tracing::instrument(skip(state, params), err)]
pub async fn app_server_remote_settings_update(
    state: tauri::State<'_, AppState>,
    params: RemoteSettingsUpdateParams,
) -> Result<RemoteSettingsResult, String> {
    let native_state = state.inner().clone();
    let settings = call_app_server(state, "remote_settings_update", |client| {
        Box::pin(async move { client.remote_settings_update(params).await })
    })
    .await?;
    native_state.sync_remote_keep_awake(settings.allow_connections && settings.keep_awake)?;
    Ok(settings)
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_sync_configure(
    state: tauri::State<'_, AppState>,
    device_id: Option<String>,
    last_sync_version: Option<i64>,
) -> Result<SyncStatusResult, String> {
    call_app_server(state, "sync_configure", |client| {
        Box::pin(async move {
            client
                .sync_configure(sync_configure_params(device_id, last_sync_version))
                .await
        })
    })
    .await
}

pub(super) fn sync_configure_params(
    device_id: Option<String>,
    last_sync_version: Option<i64>,
) -> SyncConfigureParams {
    SyncConfigureParams {
        device_id,
        last_sync_version,
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_metadata_clear_all(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    call_app_server(state, "metadata_clear_all", |client| {
        Box::pin(async move { client.metadata_clear_all().await.map(|_| ()) })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_quick_mode_set(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<QuickModeResult, String> {
    call_app_server(state, "quick_mode_set", |client| {
        Box::pin(async move { client.quick_mode_set(QuickModeSetParams { enabled }).await })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_autonomous_mode_set(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<QuickModeResult, String> {
    call_app_server(state, "autonomous_mode_set", |client| {
        Box::pin(async move {
            client
                .autonomous_mode_set(RunModeSetParams { enabled })
                .await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_computer_use_mode_set(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<QuickModeResult, String> {
    call_app_server(state, "computer_use_mode_set", |client| {
        Box::pin(async move {
            client
                .computer_use_mode_set(RunModeSetParams { enabled })
                .await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_hybrid_mode_set(
    state: tauri::State<'_, AppState>,
    enabled: bool,
    model_id: Option<String>,
    role: Option<String>,
) -> Result<HybridModeResult, String> {
    call_app_server(state, "hybrid_mode_set", |client| {
        Box::pin(async move {
            client
                .hybrid_mode_set(hybrid_mode_set_params(enabled, model_id, role))
                .await
        })
    })
    .await
}

pub(super) fn hybrid_mode_set_params(
    enabled: bool,
    model_id: Option<String>,
    role: Option<String>,
) -> HybridModeSetParams {
    HybridModeSetParams {
        enabled,
        model_id,
        role,
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_model_select(
    state: tauri::State<'_, AppState>,
    model_id: String,
) -> Result<ModelListResult, String> {
    call_app_server(state, "model_select", |client| {
        Box::pin(async move { client.model_select(ModelSelectParams { model_id }).await })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_plugin_set_enabled(
    state: tauri::State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> Result<PluginListResult, String> {
    call_app_server(state, "plugin_set_enabled", |client| {
        Box::pin(async move {
            client
                .plugin_set_enabled(PluginSetEnabledParams { plugin_id, enabled })
                .await
        })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_desktop_sync_pull(
    state: tauri::State<'_, AppState>,
    last_sync_version: i64,
    device_id: String,
    limit: Option<usize>,
) -> Result<DesktopSyncPullResult, String> {
    call_app_server(state, "desktop_sync_pull", |client| {
        Box::pin(async move {
            client
                .desktop_sync_pull(desktop_sync_pull_params(
                    last_sync_version,
                    device_id,
                    limit,
                ))
                .await
        })
    })
    .await
}

pub(super) fn desktop_sync_pull_params(
    last_sync_version: i64,
    device_id: String,
    limit: Option<usize>,
) -> DesktopSyncPullParams {
    DesktopSyncPullParams {
        device_id,
        last_sync_version,
        limit,
    }
}

#[tauri::command]
#[tracing::instrument(skip(state, conversations, messages, deletions), err)]
pub async fn app_server_desktop_sync_push(
    state: tauri::State<'_, AppState>,
    conversations: Vec<serde_json::Value>,
    messages: Vec<serde_json::Value>,
    deletions: Vec<serde_json::Value>,
    device_id: String,
) -> Result<DesktopSyncPushResult, String> {
    call_app_server(state, "desktop_sync_push", |client| {
        Box::pin(async move {
            client
                .desktop_sync_push(desktop_sync_push_params(
                    conversations,
                    messages,
                    deletions,
                    device_id,
                ))
                .await
        })
    })
    .await
}

pub(super) fn desktop_sync_push_params(
    conversations: Vec<serde_json::Value>,
    messages: Vec<serde_json::Value>,
    deletions: Vec<serde_json::Value>,
    device_id: String,
) -> DesktopSyncPushParams {
    DesktopSyncPushParams {
        conversations,
        messages,
        deletions,
        device_id,
    }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_ollama_status(
    state: tauri::State<'_, AppState>,
    base_url: Option<String>,
) -> Result<OllamaStatusResult, String> {
    call_app_server(state, "ollama_status", |client| {
        Box::pin(async move { client.ollama_status(ollama_status_params(base_url)).await })
    })
    .await
}

pub(super) fn ollama_status_params(base_url: Option<String>) -> OllamaStatusParams {
    OllamaStatusParams { base_url }
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn app_server_ollama_ensure(
    state: tauri::State<'_, AppState>,
    base_url: Option<String>,
    model_id: Option<String>,
) -> Result<OllamaEnsureResult, String> {
    call_app_server(state, "ollama_ensure", |client| {
        Box::pin(async move {
            client
                .ollama_ensure(ollama_ensure_params(base_url, model_id))
                .await
        })
    })
    .await
}

pub(super) fn ollama_ensure_params(
    base_url: Option<String>,
    model_id: Option<String>,
) -> OllamaEnsureParams {
    OllamaEnsureParams { base_url, model_id }
}
