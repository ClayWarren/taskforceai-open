use std::mem;

use taskforceai_app_protocol::AttachmentRecord;

use super::{AppState, PastedBlock};

#[derive(Debug, Clone)]
pub struct PendingSubmission {
    pub id: u64,
    pub display_prompt: String,
    draft_input: String,
    draft_cursor: usize,
    draft_pasted_blocks: Vec<PastedBlock>,
    draft_attachments: Vec<AttachmentRecord>,
}

impl AppState {
    pub fn begin_prompt_submission(&mut self, display_prompt: String) -> u64 {
        self.next_submission_id = self.next_submission_id.wrapping_add(1).max(1);
        let id = self.next_submission_id;
        self.pending_submission = Some(PendingSubmission {
            id,
            display_prompt,
            draft_input: mem::take(&mut self.prompt_input),
            draft_cursor: mem::take(&mut self.prompt_cursor),
            draft_pasted_blocks: mem::take(&mut self.pasted_blocks),
            draft_attachments: mem::take(&mut self.attachments),
        });
        self.prompt_history_index = None;
        self.prompt_history_draft.clear();
        self.file_suggestions.clear();
        self.selected_file_suggestion = None;
        self.command_suggestions.clear();
        self.selected_command_suggestion = None;
        self.suggestions_suppressed = false;
        self.command_output = None;
        self.model_selector = None;
        self.effort_selector = None;
        self.agent_mode_selector = None;
        self.team_config = None;
        self.picker = None;
        self.launch_screen_visible = false;
        self.status_line = "Starting task".to_string();
        id
    }

    pub fn finish_prompt_submission(&mut self, id: u64, status: impl Into<String>) {
        if self
            .pending_submission
            .as_ref()
            .is_some_and(|pending| pending.id == id)
        {
            self.pending_submission = None;
            self.status_line = status.into();
        }
    }

    pub fn fail_prompt_submission(&mut self, id: u64, message: impl Into<String>) {
        let Some(pending) = self
            .pending_submission
            .take()
            .filter(|pending| pending.id == id)
        else {
            return;
        };
        if self.prompt_input.is_empty() && self.attachments.is_empty() {
            self.prompt_input = pending.draft_input;
            self.prompt_cursor = pending.draft_cursor.min(self.prompt_input.len());
            self.pasted_blocks = pending.draft_pasted_blocks;
            self.attachments = pending.draft_attachments;
        } else if !pending.draft_input.trim().is_empty() {
            self.record_prompt_history(&pending.draft_input);
        }
        let message = message.into();
        self.status_line = format!("Submission failed: {message}");
        self.command_output = Some(format!(
            "Submission Failed\n{message}\nYour prompt was restored for retry."
        ));
        self.refresh_command_suggestions();
    }

    pub fn needs_animation(&self) -> bool {
        !self.auth_checked
            || self.login_starting
            || self.pending_login.is_some()
            || self.pending_submission.is_some()
            || self.active_turn().is_some()
            || self.runs.iter().any(|run| {
                matches!(
                    // coverage:ignore-line -- structural matches macro expansion.
                    run.status,
                    taskforceai_app_protocol::RunStatus::Queued
                        | taskforceai_app_protocol::RunStatus::Processing
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{RunRecord, RunStatus};

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn optimistic_submission_clears_and_restores_the_draft() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.prompt_input = "ship it".to_string();
        state.prompt_cursor = state.prompt_input.len();

        let id = state.begin_prompt_submission("ship it".to_string());

        assert!(state.prompt_input.is_empty());
        assert_eq!(
            state.pending_submission.as_ref().map(|item| item.id),
            Some(id)
        );
        assert!(!state.launch_screen_visible);

        state.fail_prompt_submission(id, "offline");

        assert_eq!(state.prompt_input, "ship it");
        assert_eq!(state.prompt_cursor, "ship it".len());
        assert!(state.pending_submission.is_none());
    }

    #[test]
    fn submission_edges_preserve_new_drafts_and_report_animation() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.auth_checked = true;
        state.fail_prompt_submission(99, "stale");

        state.prompt_input = "old draft".to_string();
        let id = state.begin_prompt_submission("old draft".to_string());
        state.prompt_input = "new draft".to_string();
        state.fail_prompt_submission(id, "offline");
        assert_eq!(state.prompt_input, "new draft");
        assert_eq!(state.prompt_history, vec!["old draft"]);

        assert!(!state.needs_animation());
        state.login_starting = true;
        assert!(state.needs_animation());
        state.login_starting = false;
        state.auth_checked = false;
        assert!(state.needs_animation());

        state.auth_checked = true;
        state.runs.push(RunRecord {
            id: "queued".to_string(),
            prompt: "ship".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Queued,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        });
        assert!(state.needs_animation());
    }
}
