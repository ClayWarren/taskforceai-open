use std::collections::VecDeque;
use std::time::{Duration, Instant};

use taskforceai_app_protocol::{
    AttachmentRecord, ContextSummaryResult, GitReviewStatusResult, InitializeResult,
    ModelOptionRecord, OrchestrationConfig, RunRecord, SkillRecord, ThreadRecord,
};

mod actions;
pub(crate) mod commands;
mod composer;
mod interactions;
mod picker;
mod polling;
mod progress;
mod selection;
mod submission;
mod team_config;
mod threads;

pub use actions::UiAction;
pub use interactions::PendingInteraction;
pub use picker::{PickerKind, PickerOption, PickerState};
pub use submission::PendingSubmission;

pub(super) const SYNC_POLL_INTERVAL: Duration = Duration::from_secs(15);
pub(super) const PENDING_REPLAY_INTERVAL: Duration = Duration::from_secs(30);
pub(super) const GIT_CONTEXT_POLL_INTERVAL: Duration = Duration::from_secs(5);
pub(crate) const MAX_PROMPT_HISTORY: usize = 200;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthUiState {
    Checking,
    SignedOut,
    Starting,
    WaitingForBrowser,
    SignedIn,
}

#[derive(Debug, Clone)]
pub struct PastedBlock {
    pub marker: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
    pub priority: Option<String>,
}

#[derive(Debug, Clone)]
struct ComposerSnapshot {
    input: String,
    cursor: usize,
    pasted_blocks: Vec<PastedBlock>,
}

impl TaskMode {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Work => "work",
            Self::Code => "code",
        }
    }

    pub const fn shows_task_progress(self) -> bool {
        matches!(self, Self::Work | Self::Code)
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
    pub pasted_blocks: Vec<PastedBlock>,
    pub attachments: Vec<AttachmentRecord>,
    pub skills: Vec<SkillRecord>,
    pub file_suggestions: Vec<String>,
    pub selected_file_suggestion: Option<usize>,
    pub command_suggestions: Vec<&'static str>,
    pub selected_command_suggestion: Option<usize>,
    pub suggestions_suppressed: bool,
    pub command_output: Option<String>,
    pub pending_interaction: Option<PendingInteraction>,
    pub queued_interactions: VecDeque<PendingInteraction>,
    pub authenticated: bool,
    pub auth_checked: bool,
    pub login_starting: bool,
    pub login_error: Option<String>,
    pub current_login_attempt_id: Option<u64>,
    pub private_chat_enabled: bool,
    pub task_mode: TaskMode,
    pub plan_mode_enabled: bool,
    pub todos: Vec<TodoItem>,
    pub context_summary: Option<ContextSummaryResult>,
    pub next_context_refresh_at: Instant,
    pub theme_name: String,
    pub terminal_focused: bool,
    pub quick_mode_enabled: bool,
    pub autonomous_mode_enabled: bool,
    pub computer_use_enabled: bool,
    pub workspace: Option<String>,
    pub git_context: Option<GitReviewStatusResult>,
    pub next_git_context_refresh_at: Instant,
    pub model_selector: Option<ModelSelectorState>,
    pub reasoning_effort: Option<String>,
    pub effort_selector: Option<EffortSelectorState>,
    pub agent_mode_selector: Option<AgentModeSelectorState>,
    pub team_config: Option<TeamConfigState>,
    pub orchestration_agent_count: u16,
    pub picker: Option<PickerState>,
    pub sidebar_collapsed: bool,
    pub launch_screen_visible: bool,
    pub raw_output_mode: bool,
    pub reasoning_visible: bool,
    pub tool_details_expanded: bool,
    pub focus: FocusArea,
    pub detail_scroll_offset: u16,
    pub pending_login: Option<PendingLogin>,
    pub last_sync_event_id: Option<String>,
    pub next_sync_poll_at: Instant,
    pub next_pending_replay_at: Instant,
    pub status_line: String,
    pub pet: taskforceai_app_protocol::PetState,
    pub animation_frame: u64,
    pub pending_submission: Option<PendingSubmission>,
    next_submission_id: u64,
    next_login_attempt_id: u64,
    pub external_editor_requested: bool,
    pub escape_armed_until: Option<Instant>,
    pub quit_armed_until: Option<Instant>,
    pub should_quit: bool,
    prompt_undo_stack: Vec<ComposerSnapshot>,
    prompt_redo_stack: Vec<ComposerSnapshot>,
    prompt_kill_buffer: String,
}

#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub attempt_id: u64,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_at: Instant,
    pub next_poll_at: Instant,
    pub interval: Duration,
    pub poll_in_flight: bool,
}

#[derive(Debug, Clone)]
pub struct ModelSelectorState {
    pub options: Vec<ModelOptionRecord>,
    pub default_model_id: String,
    pub selected_model_id: Option<String>,
    pub selected_index: usize,
    pub remote_catalog: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelSelectorTarget {
    Model,
    Effort,
    AgentMode,
}

#[derive(Debug, Clone)]
pub struct AgentModeSelectorState {
    pub selected_index: usize,
}

#[derive(Debug, Clone)]
pub struct TeamConfigState {
    pub orchestration: OrchestrationConfig,
    pub models: Vec<ModelOptionRecord>,
    pub default_model_id: String,
    pub agent_count: u16,
    pub selected_index: usize,
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
            pasted_blocks: Vec::new(),
            attachments: Vec::new(),
            skills: Vec::new(),
            file_suggestions: Vec::new(),
            selected_file_suggestion: None,
            command_suggestions: Vec::new(),
            selected_command_suggestion: None,
            suggestions_suppressed: false,
            command_output: None,
            pending_interaction: None,
            queued_interactions: VecDeque::new(),
            authenticated: false,
            auth_checked: false,
            login_starting: false,
            login_error: None,
            current_login_attempt_id: None,
            private_chat_enabled: false,
            task_mode: TaskMode::Chat,
            plan_mode_enabled: false,
            todos: Vec::new(),
            context_summary: None,
            next_context_refresh_at: Instant::now(),
            theme_name: "taskforce-dark".to_string(),
            terminal_focused: true,
            quick_mode_enabled: true,
            autonomous_mode_enabled: false,
            computer_use_enabled: false,
            workspace: None,
            git_context: None,
            next_git_context_refresh_at: Instant::now(),
            model_selector: None,
            reasoning_effort: None,
            effort_selector: None,
            agent_mode_selector: None,
            team_config: None,
            orchestration_agent_count: 4,
            picker: None,
            sidebar_collapsed: true,
            launch_screen_visible: true,
            raw_output_mode: false,
            reasoning_visible: false,
            tool_details_expanded: false,
            focus: FocusArea::Prompt,
            detail_scroll_offset: 0,
            pending_login: None,
            last_sync_event_id: None,
            next_sync_poll_at: Instant::now() + SYNC_POLL_INTERVAL,
            next_pending_replay_at: Instant::now() + PENDING_REPLAY_INTERVAL,
            status_line: "Connected to app-server".to_string(),
            pet: default_pet_state(),
            animation_frame: 0,
            pending_submission: None,
            next_submission_id: 0,
            next_login_attempt_id: 0,
            external_editor_requested: false,
            escape_armed_until: None,
            quit_armed_until: None,
            should_quit: false,
            prompt_undo_stack: Vec::new(),
            prompt_redo_stack: Vec::new(),
            prompt_kill_buffer: String::new(),
        }
        .with_default_selection()
    }

    pub fn set_authenticated(&mut self, authenticated: bool) {
        self.auth_checked = true;
        self.authenticated = authenticated;
        if authenticated {
            self.login_starting = false;
            self.pending_login = None;
            self.current_login_attempt_id = None;
            self.login_error = None;
        }
        if !authenticated {
            self.private_chat_enabled = false;
        }
        self.refresh_command_suggestions();
    }

    pub fn auth_ui_state(&self) -> AuthUiState {
        if !self.auth_checked {
            AuthUiState::Checking
        } else if self.login_starting {
            AuthUiState::Starting
        } else if self.pending_login.is_some() {
            AuthUiState::WaitingForBrowser
        } else if self.authenticated {
            AuthUiState::SignedIn
        } else {
            AuthUiState::SignedOut
        }
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
