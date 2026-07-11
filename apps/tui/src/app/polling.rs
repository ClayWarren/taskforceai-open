use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    DeviceLoginPollParams, HistoryListParams, SyncPullParams, SyncRealtimePollParams,
};

use crate::state::{AppState, UiAction};

pub(super) async fn poll_login_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let now = std::time::Instant::now();
    if state.login_expired(now) {
        state.mark_login_expired();
        return Ok(());
    }
    let Some(device_code) = state.due_login_device_code(now) else {
        return Ok(());
    };
    let result = client
        .auth_device_poll(DeviceLoginPollParams { device_code })
        .await;
    match result {
        Ok(result) => state.apply(UiAction::LoginPolled(result)),
        Err(err) => state.mark_login_poll_failed(format!("Login poll failed: {err}")),
    }
    Ok(())
}

pub(super) async fn poll_sync_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(last_event_id) = state.due_sync_last_event_id(std::time::Instant::now()) else {
        return Ok(());
    };
    let result = client
        .sync_realtime_poll(SyncRealtimePollParams { last_event_id })
        .await;
    match result {
        Ok(result) => {
            let has_updates = result.has_updates;
            state.apply(UiAction::SyncRealtimePolled(result));
            if has_updates {
                let pulled = match client.sync_pull(SyncPullParams { limit: Some(50) }).await {
                    Ok(pulled) => pulled,
                    Err(err) => {
                        state.mark_sync_poll_failed(format!("Sync pull failed: {err}"));
                        return Ok(());
                    }
                };
                let history = match client.history_list(HistoryListParams { limit: 50 }).await {
                    Ok(history) => history,
                    Err(err) => {
                        state.mark_sync_poll_failed(format!("Sync history refresh failed: {err}"));
                        return Ok(());
                    }
                };
                state.apply(UiAction::HistoryLoaded(history.runs));
                state.status_line = format!(
                    "Sync pulled {} conversations and {} messages",
                    pulled.conversations.len(),
                    pulled.messages.len()
                );
            } // coverage:ignore-line -- structural sync-pull branch close.
        }
        Err(err) => state.mark_sync_poll_failed(format!("Sync poll failed: {err}")),
    }
    Ok(())
}

pub(super) async fn replay_pending_prompt_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    if !state.pending_replay_due(std::time::Instant::now()) {
        return Ok(());
    }
    let result = client.pending_prompt_replay().await;
    match result {
        Ok(result) => state.apply(UiAction::PendingPromptReplayed(Box::new(result))),
        Err(err) => state.mark_pending_replay_failed(format!("Pending replay failed: {err}")),
    }
    Ok(())
}
