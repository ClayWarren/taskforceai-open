use std::time::{Duration, Instant};

use taskforceai_app_protocol::{
    DeviceLoginPollResult, DeviceLoginStartResult, GitReviewStatusResult,
    PendingPromptReplayResult, SyncRealtimePollResult,
};

use super::{
    AppState, PendingLogin, TaskMode, GIT_CONTEXT_POLL_INTERVAL, PENDING_REPLAY_INTERVAL,
    SYNC_POLL_INTERVAL,
};

impl AppState {
    pub fn git_context_refresh_due(&self, now: Instant) -> bool {
        self.task_mode == TaskMode::Code && now >= self.next_git_context_refresh_at
    }

    pub fn apply_git_context(&mut self, result: GitReviewStatusResult) {
        self.git_context = result.is_git_repository.then_some(result);
        self.next_git_context_refresh_at = Instant::now() + GIT_CONTEXT_POLL_INTERVAL;
    }

    pub fn clear_git_context(&mut self) {
        self.git_context = None;
        self.next_git_context_refresh_at = Instant::now();
    }

    pub fn mark_git_context_refresh_failed(&mut self) {
        self.next_git_context_refresh_at = Instant::now() + GIT_CONTEXT_POLL_INTERVAL;
    }

    pub fn begin_login_attempt(&mut self) -> u64 {
        let attempt_id = self.next_login_attempt_id;
        self.next_login_attempt_id = self.next_login_attempt_id.wrapping_add(1);
        self.auth_checked = true;
        self.authenticated = false;
        self.login_starting = true;
        self.login_error = None;
        self.current_login_attempt_id = Some(attempt_id);
        self.pending_login = None;
        self.command_output = None;
        self.launch_screen_visible = true;
        self.clear_prompt();
        self.status_line = "Starting sign in".to_string();
        self.refresh_command_suggestions();
        attempt_id
    }

    pub fn login_attempt_matches(&self, attempt_id: u64) -> bool {
        self.current_login_attempt_id == Some(attempt_id)
    }

    pub fn apply_login_started(&mut self, attempt_id: u64, result: DeviceLoginStartResult) {
        if !self.login_attempt_matches(attempt_id) {
            return;
        }
        let interval = Duration::from_secs(result.interval.max(1) as u64);
        let now = Instant::now();
        self.login_starting = false;
        self.pending_login = Some(PendingLogin {
            attempt_id,
            device_code: result.device_code,
            user_code: result.user_code,
            verification_uri: result.verification_uri,
            verification_uri_complete: result.verification_uri_complete,
            expires_at: now + Duration::from_secs(result.expires_in.max(1) as u64),
            next_poll_at: now + interval,
            interval,
            poll_in_flight: false,
        });
        self.login_error = None;
        self.command_output = None;
        self.launch_screen_visible = true;
        self.status_line = "Waiting for login approval".to_string();
    }

    pub fn mark_login_start_failed(&mut self, attempt_id: u64, message: impl Into<String>) {
        if !self.login_attempt_matches(attempt_id) {
            return;
        }
        let message = message.into();
        self.login_starting = false;
        self.current_login_attempt_id = None;
        self.pending_login = None;
        self.login_error = Some(message.clone());
        self.status_line = message;
    }

    pub fn cancel_login(&mut self, message: impl Into<String>) {
        self.login_starting = false;
        self.current_login_attempt_id = None;
        self.pending_login = None;
        self.login_error = None;
        self.command_output = None;
        self.launch_screen_visible = true;
        self.status_line = message.into();
    }

    pub fn take_due_login_poll(&mut self, now: Instant) -> Option<(u64, String)> {
        let login = self.pending_login.as_mut()?;
        if now >= login.expires_at {
            return None;
        }
        if now >= login.next_poll_at && !login.poll_in_flight {
            login.poll_in_flight = true;
            return Some((login.attempt_id, login.device_code.clone()));
        }
        None
    }

    pub fn login_expired(&self, now: Instant) -> bool {
        self.pending_login
            .as_ref()
            .is_some_and(|login| now >= login.expires_at)
    }

    pub fn mark_login_expired(&mut self) {
        self.set_authenticated(false);
        self.pending_login = None;
        self.current_login_attempt_id = None;
        self.login_starting = false;
        self.login_error = Some("Device login expired. Press Enter to try again.".to_string());
        self.command_output = None;
        self.launch_screen_visible = true;
        self.status_line = "Login expired".to_string();
    }

    pub fn mark_login_poll_failed(&mut self, attempt_id: u64, message: impl Into<String>) {
        if !self.login_attempt_matches(attempt_id) {
            return;
        }
        if let Some(login) = &mut self.pending_login {
            login.poll_in_flight = false;
            login.next_poll_at = Instant::now() + login.interval;
        }
        let message = message.into();
        self.login_error = Some(message.clone());
        self.status_line = message;
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

    pub(super) fn apply_login_poll(&mut self, attempt_id: u64, result: DeviceLoginPollResult) {
        if !self.login_attempt_matches(attempt_id) {
            return;
        }
        match result.status.as_str() {
            "approved" => {
                self.set_authenticated(true);
                self.command_output = None;
                self.launch_screen_visible = true;
                self.status_line = "Authenticated".to_string();
            }
            "pending" => {
                if let Some(login) = &mut self.pending_login {
                    login.poll_in_flight = false;
                    let interval = result
                        .interval
                        .map(|value| Duration::from_secs(value.max(1) as u64))
                        .unwrap_or(login.interval);
                    login.interval = interval;
                    login.next_poll_at = Instant::now() + interval;
                    self.login_error = None;
                    self.status_line = "Waiting for login approval".to_string();
                }
            }
            _ => {
                self.set_authenticated(false);
                self.pending_login = None;
                self.current_login_attempt_id = None;
                self.login_error = Some(format!("Login ended: {}", result.status));
                self.command_output = None;
                self.launch_screen_visible = true;
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

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{DeviceLoginStartResult, GitReviewStatusResult};

    use super::*;
    use crate::test_support::initialized;

    #[test]
    fn polling_edges_cover_git_context_and_stale_login_attempts() {
        let mut state = AppState::new(initialized(), Vec::new());
        let now = Instant::now();
        state.next_git_context_refresh_at = now;
        state.task_mode = TaskMode::Code;
        assert!(state.git_context_refresh_due(now));
        state.task_mode = TaskMode::Chat;
        assert!(!state.git_context_refresh_due(now));

        state.apply_git_context(GitReviewStatusResult {
            is_git_repository: false,
            workspace: "/tmp".to_string(),
            repository_root: None,
            branch: None,
            head: None,
            upstream: None,
            base_ref: None,
            has_staged_changes: false,
            has_unstaged_changes: false,
            has_untracked_files: false,
            pull_request: None,
            files: Vec::new(),
            message: String::new(),
        });
        assert!(state.git_context.is_none());
        state.clear_git_context();
        state.mark_git_context_refresh_failed();

        let attempt = state.begin_login_attempt();
        let start = DeviceLoginStartResult {
            device_code: "device".to_string(),
            user_code: "USER".to_string(),
            verification_uri: "https://example.test".to_string(),
            verification_uri_complete: "https://example.test/complete".to_string(),
            expires_in: 60,
            interval: 1,
        };
        state.apply_login_started(attempt + 1, start.clone());
        assert!(state.pending_login.is_none());
        state.mark_login_start_failed(attempt + 1, "stale");
        state.apply_login_started(attempt, start);
        state.mark_login_start_failed(attempt, "offline");
        assert_eq!(state.login_error.as_deref(), Some("offline"));
        state.mark_login_poll_failed(attempt + 1, "stale");
    }
}
