use std::time::{Duration, Instant};

use taskforceai_app_protocol::{
    DeviceLoginPollResult, PendingPromptReplayResult, SyncRealtimePollResult,
};

use super::{AppState, PENDING_REPLAY_INTERVAL, SYNC_POLL_INTERVAL};

impl AppState {
    pub fn due_login_device_code(&self, now: Instant) -> Option<String> {
        let login = self.pending_login.as_ref()?;
        if now >= login.expires_at {
            return None;
        }
        if now >= login.next_poll_at {
            return Some(login.device_code.clone());
        }
        None
    }

    pub fn login_expired(&self, now: Instant) -> bool {
        self.pending_login
            .as_ref()
            .is_some_and(|login| now >= login.expires_at)
    }

    pub fn mark_login_expired(&mut self) {
        self.pending_login = None;
        self.command_output =
            Some("Login\nDevice login expired. Run /login to try again.".to_string());
        self.status_line = "Login expired".to_string();
    }

    pub fn mark_login_poll_failed(&mut self, message: impl Into<String>) {
        if let Some(login) = &mut self.pending_login {
            login.next_poll_at = Instant::now() + login.interval;
        }
        self.status_line = message.into();
    }

    pub fn due_sync_last_event_id(&self, now: Instant) -> Option<Option<String>> {
        if !self.initialized.capabilities.sync || now < self.next_sync_poll_at {
            return None;
        }
        Some(self.last_sync_event_id.clone())
    }

    pub fn mark_sync_poll_failed(&mut self, message: impl Into<String>) {
        self.next_sync_poll_at = Instant::now() + SYNC_POLL_INTERVAL;
        self.status_line = message.into();
    }

    pub fn pending_replay_due(&self, now: Instant) -> bool {
        self.initialized.capabilities.pending_prompts && now >= self.next_pending_replay_at
    }

    pub fn mark_pending_replay_failed(&mut self, message: impl Into<String>) {
        self.next_pending_replay_at = Instant::now() + PENDING_REPLAY_INTERVAL;
        self.status_line = message.into();
    }

    pub(super) fn apply_login_poll(&mut self, result: DeviceLoginPollResult) {
        match result.status.as_str() {
            "approved" => {
                self.pending_login = None;
                self.command_output = Some("Login\nAuthenticated.".to_string());
                self.status_line = "Authenticated".to_string();
            }
            "pending" => {
                if let Some(login) = &mut self.pending_login {
                    let interval = result
                        .interval
                        .map(|value| Duration::from_secs(value.max(1) as u64))
                        .unwrap_or(login.interval);
                    login.interval = interval;
                    login.next_poll_at = Instant::now() + interval;
                    self.status_line = "Waiting for login approval".to_string();
                }
            }
            _ => {
                self.pending_login = None;
                self.command_output = Some(format!("Login\nStatus: {}", result.status));
                self.status_line = "Login ended".to_string();
            }
        }
    }

    pub(super) fn apply_sync_realtime_poll(&mut self, result: SyncRealtimePollResult) {
        if !result.last_event_id.trim().is_empty() {
            self.last_sync_event_id = Some(result.last_event_id);
        }
        self.next_sync_poll_at = Instant::now() + SYNC_POLL_INTERVAL;
        if result.has_updates {
            self.status_line = "Sync updates detected".to_string();
        }
    }

    pub(super) fn apply_pending_prompt_replay(&mut self, result: PendingPromptReplayResult) {
        self.next_pending_replay_at = Instant::now() + PENDING_REPLAY_INTERVAL;
        if let Some(run) = result.run {
            self.upsert_run(run);
        }
        if result.attempted {
            self.status_line = result.message;
        }
    }
}
