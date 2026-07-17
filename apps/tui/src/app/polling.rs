use taskforceai_app_client::{AppClientError, AppServerClient, AppServerRequestHandle};
use taskforceai_app_protocol::{
    DeviceLoginPollParams, GitReviewStatusParams, HistoryListParams, SyncPullParams,
    SyncRealtimePollParams,
};

use crate::state::{AppState, UiAction};

use super::BackgroundTaskResult;

// coverage:ignore-start -- polls live app-server context state.
pub(super) async fn poll_context_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    if !state.context_refresh_due(std::time::Instant::now()) {
        return Ok(());
    }
    match client.context_summary().await {
        Ok(summary) => state.apply_context_summary(summary),
        Err(_) => state.mark_context_refresh_failed(),
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- polls live git context through app-server RPC.
pub(super) async fn poll_git_context_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    if !state.git_context_refresh_due(std::time::Instant::now()) {
        return Ok(());
    }
    match client
        .git_review_status(GitReviewStatusParams {
            workspace: state.workspace.clone(),
        })
        .await
    {
        Ok(status) => state.apply_git_context(status),
        Err(_) => state.mark_git_context_refresh_failed(),
    }
    Ok(())
}
// coverage:ignore-end

pub(super) fn schedule_login_poll_if_due(
    client: AppServerRequestHandle,
    state: &mut AppState,
) -> Option<tokio::task::JoinHandle<BackgroundTaskResult>> {
    let now = std::time::Instant::now();
    if state.login_expired(now) {
        state.mark_login_expired();
        return None;
    }
    let (attempt_id, device_code) = state.take_due_login_poll(now)?;
    Some(tokio::spawn(async move {
        let result = client
            .auth_device_poll(DeviceLoginPollParams { device_code })
            .await
            .map_err(|error| format!("Login poll failed: {error}"));
        BackgroundTaskResult::LoginPoll { attempt_id, result }
    }))
}

#[cfg(test)]
// coverage:ignore-start -- polls an active device login over live app-server RPC.
pub(super) async fn poll_login_if_due(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(task) = schedule_login_poll_if_due(client.request_handle(), state) else {
        return Ok(());
    };
    match task.await.expect("login poll task should join") {
        BackgroundTaskResult::LoginPoll { attempt_id, result } => match result {
            Ok(result) => state.apply(UiAction::LoginPolled { attempt_id, result }),
            Err(message) => state.mark_login_poll_failed(attempt_id, message),
        },
        _ => unreachable!("login poll helper only schedules login polling"),
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- pulls live multi-page sync state over app-server RPC.
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
            let should_pull = result.has_updates || state.last_sync_event_id.is_none();
            state.apply(UiAction::SyncRealtimePolled(result));
            if should_pull {
                let mut pulled_conversations = 0;
                let mut pulled_messages = 0;
                let mut completed_pull = false;
                for _ in 0..100 {
                    let pulled = match client.sync_pull(SyncPullParams { limit: Some(50) }).await {
                        Ok(pulled) => pulled,
                        Err(err) => {
                            state.mark_sync_poll_failed(format!("Sync pull failed: {err}"));
                            return Ok(());
                        }
                    };
                    pulled_conversations += pulled.conversations.len();
                    pulled_messages += pulled.messages.len();
                    if !pulled.has_more {
                        completed_pull = true;
                        break;
                    }
                }
                if !completed_pull {
                    state.mark_sync_poll_failed(
                        "Sync pull failed: pagination exceeded 100 pages".to_string(),
                    );
                    return Ok(());
                }
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
                    pulled_conversations, pulled_messages
                );
            } // coverage:ignore-line -- structural sync-pull branch close.
        }
        Err(err) => state.mark_sync_poll_failed(format!("Sync poll failed: {err}")),
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- replays durable pending prompts over live app-server RPC.
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
// coverage:ignore-end
