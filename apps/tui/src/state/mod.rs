use std::time::{Duration, Instant};

use taskforceai_app_protocol::{
    AttachmentRecord, InitializeResult, ModelOptionRecord, RunRecord, ThreadRecord,
};

mod actions;
mod commands;
mod composer;
mod interactions;
mod polling;
mod selection;
mod threads;

pub use actions::UiAction;
pub use interactions::PendingInteraction;

pub(super) const SYNC_POLL_INTERVAL: Duration = Duration::from_secs(15);
pub(super) const PENDING_REPLAY_INTERVAL: Duration = Duration::from_secs(30);
pub const PRIVATE_CHAT_DISCLOSURE: &str =
    "This chat won't appear in your history, be added to memory, or be used to train models.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusArea {
    Runs,
    Prompt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskMode {
    Chat,
    Work,
    Code,
}

impl TaskMode {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Work => "work",
            Self::Code => "code",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub initialized: InitializeResult,
    pub runs: Vec<RunRecord>,
    pub threads: Vec<ThreadRecord>,
    pub active_thread_id: Option<String>,
    pub selected_run_id: Option<String>,
    pub selected_run_index: Option<usize>,
    pub current_model_id: String,
    pub prompt_input: String,
    pub prompt_cursor: usize,
    pub prompt_history: Vec<String>,
    pub prompt_history_index: Option<usize>,
    pub prompt_history_draft: String,
    pub attachments: Vec<AttachmentRecord>,
    pub file_suggestions: Vec<String>,
    pub selected_file_suggestion: Option<usize>,
    pub command_suggestions: Vec<&'static str>,
    pub selected_command_suggestion: Option<usize>,
    pub command_output: Option<String>,
    pub pending_interaction: Option<PendingInteraction>,
    pub authenticated: bool,
    pub private_chat_enabled: bool,
    pub task_mode: TaskMode,
    pub workspace: Option<String>,
    pub model_selector: Option<ModelSelectorState>,
    pub reasoning_effort: Option<String>,
    pub effort_selector: Option<EffortSelectorState>,
    pub sidebar_collapsed: bool,
    pub raw_output_mode: bool,
    pub focus: FocusArea,
    pub detail_scroll_offset: u16,
    pub pending_login: Option<PendingLogin>,
    pub last_sync_event_id: Option<String>,
    pub next_sync_poll_at: Instant,
    pub next_pending_replay_at: Instant,
    pub status_line: String,
    pub pet: taskforceai_app_protocol::PetState,
    pub animation_frame: u64,
    pub should_quit: bool,
}

#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub device_code: String,
    pub expires_at: Instant,
    pub next_poll_at: Instant,
    pub interval: Duration,
}

#[derive(Debug, Clone)]
pub struct ModelSelectorState {
    pub options: Vec<ModelOptionRecord>,
    pub default_model_id: String,
    pub selected_model_id: Option<String>,
    pub selected_index: usize,
    pub remote_catalog: bool,
}

#[derive(Debug, Clone)]
pub struct EffortSelectorState {
    pub model_id: String,
    pub levels: Vec<String>,
    pub selected_index: usize,
}

impl AppState {
    pub fn new(initialized: InitializeResult, runs: Vec<RunRecord>) -> Self {
        Self {
            initialized,
            runs,
            threads: Vec::new(),
            active_thread_id: None,
            selected_run_id: None,
            selected_run_index: None,
            current_model_id: "default".to_string(),
            prompt_input: String::new(),
            prompt_cursor: 0,
            prompt_history: Vec::new(),
            prompt_history_index: None,
            prompt_history_draft: String::new(),
            attachments: Vec::new(),
            file_suggestions: Vec::new(),
            selected_file_suggestion: None,
            command_suggestions: Vec::new(),
            selected_command_suggestion: None,
            command_output: None,
            pending_interaction: None,
            authenticated: false,
            private_chat_enabled: false,
            task_mode: TaskMode::Chat,
            workspace: None,
            model_selector: None,
            reasoning_effort: None,
            effort_selector: None,
            sidebar_collapsed: false,
            raw_output_mode: false,
            focus: FocusArea::Prompt,
            detail_scroll_offset: 0,
            pending_login: None,
            last_sync_event_id: None,
            next_sync_poll_at: Instant::now() + SYNC_POLL_INTERVAL,
            next_pending_replay_at: Instant::now() + PENDING_REPLAY_INTERVAL,
            status_line: "Connected to app-server".to_string(),
            pet: default_pet_state(),
            animation_frame: 0,
            should_quit: false,
        }
        .with_default_selection()
    }

    pub fn set_authenticated(&mut self, authenticated: bool) {
        self.authenticated = authenticated;
        if !authenticated {
            self.private_chat_enabled = false;
        }
        self.refresh_command_suggestions();
    }
}

pub(super) fn default_pet_state() -> taskforceai_app_protocol::PetState {
    taskforceai_app_protocol::PetState {
        name: "Pulse".to_string(),
        mood: "focus".to_string(),
        visible: true,
        message: "Pulse is focused with you.".to_string(),
    }
}

#[cfg(test)]
mod tests;
