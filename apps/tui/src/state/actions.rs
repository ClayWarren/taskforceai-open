use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginPollResult, DeviceLoginStartResult, ModelListResult,
    PendingPromptReplayResult, RunRecord, SyncRealtimePollResult,
};

use super::{AppState, EffortSelectorState, PRIVATE_CHAT_DISCLOSURE};

#[derive(Debug, Clone)]
pub enum UiAction {
    QuitRequested,
    ClearScreen,
    NewPrompt,
    RunSubmitted(RunRecord),
    RunCanceled(RunRecord),
    RunDeleted(String),
    HistoryLoaded(Vec<RunRecord>),
    ModelSelectorOpened(ModelListResult),
    ModelSelectorClosed,
    SelectPreviousModel,
    SelectNextModel,
    EffortSelectorOpened(EffortSelectorState),
    EffortSelectorClosed,
    SelectPreviousEffort,
    SelectNextEffort,
    ReasoningEffortSet(Option<String>),
    CommandExecuted {
        title: String,
        message: String,
    },
    CommandOutputDisplayed {
        title: String,
        message: String,
    },
    PrivateChatSet(bool),
    LoginStarted {
        attempt_id: u64,
        result: DeviceLoginStartResult,
    },
    LoginPolled {
        attempt_id: u64,
        result: DeviceLoginPollResult,
    },
    SyncRealtimePolled(SyncRealtimePollResult),
    PendingPromptReplayed(Box<PendingPromptReplayResult>),
    SelectPreviousRun,
    SelectNextRun,
    SelectPreviousCommandSuggestion,
    SelectNextCommandSuggestion,
    SelectRunAtIndex(usize),
    LoadSelectedRunIntoPrompt,
    ToggleSidebar,
    ToggleFocus,
    ScrollDetailsUp,
    ScrollDetailsDown,
    AppendPrompt(char),
    ApplyVoiceTranscript {
        transcript: String,
        replace: bool,
    },
    BackspacePrompt,
    PromptSubmitRejected,
    ServerEvent(AppServerEvent),
    PetUpdated(taskforceai_app_protocol::PetState),
    Tick,
}

impl AppState {
    pub fn apply(&mut self, action: UiAction) {
        match action {
            UiAction::QuitRequested => {
                self.should_quit = true;
                self.status_line = "Shutting down".to_string();
            }
            UiAction::ClearScreen => {
                self.clear_prompt();
                self.command_output = None;
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.launch_screen_visible = true;
                self.status_line = "Cleared".to_string();
            }
            UiAction::NewPrompt => {
                self.clear_prompt();
                self.command_output = None;
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.selected_run_id = None;
                self.selected_run_index = None;
                self.launch_screen_visible = true;
                self.status_line = "New prompt".to_string();
            }
            UiAction::RunSubmitted(run) => {
                self.launch_screen_visible = false;
                self.upsert_run(run);
                self.command_output = None;
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.status_line = "Submitted prompt".to_string();
            }
            UiAction::CommandExecuted { title, message } => {
                self.launch_screen_visible = false;
                self.clear_prompt();
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.command_output = Some(format!("{title}\n{message}"));
                self.status_line = format!("Command executed: {title}");
            }
            UiAction::CommandOutputDisplayed { title, message } => {
                self.launch_screen_visible = false;
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.command_output = Some(format!("{title}\n{message}"));
                self.status_line = format!("Command executed: {title}");
            }
            UiAction::PrivateChatSet(enabled) => {
                self.private_chat_enabled = enabled;
                self.clear_prompt();
                self.model_selector = None;
                self.effort_selector = None;
                self.agent_mode_selector = None;
                self.team_config = None;
                self.picker = None;
                self.command_output =
                    Some(format!("Private Chat\n{}", private_chat_message(enabled)));
                self.status_line = if enabled {
                    "Private Chat enabled".to_string()
                } else {
                    "Private Chat disabled".to_string()
                };
            }
            UiAction::ModelSelectorOpened(result) => {
                self.launch_screen_visible = false;
                self.picker = None;
                self.open_model_selector(result);
            }
            UiAction::ModelSelectorClosed => {
                self.model_selector = None;
                self.status_line = "Model selector closed".to_string();
            }
            UiAction::SelectPreviousModel => self.select_model_by_delta(-1),
            UiAction::SelectNextModel => self.select_model_by_delta(1),
            UiAction::EffortSelectorOpened(selector) => self.open_effort_selector(selector),
            UiAction::EffortSelectorClosed => {
                self.effort_selector = None;
                self.status_line = "Reasoning effort selector closed".to_string();
            }
            UiAction::SelectPreviousEffort => self.select_effort_by_delta(-1),
            UiAction::SelectNextEffort => self.select_effort_by_delta(1),
            UiAction::ReasoningEffortSet(effort) => self.set_reasoning_effort(effort),
            UiAction::LoginStarted { attempt_id, result } => {
                self.apply_login_started(attempt_id, result)
            }
            UiAction::LoginPolled { attempt_id, result } => {
                self.apply_login_poll(attempt_id, result)
            }
            UiAction::SyncRealtimePolled(result) => self.apply_sync_realtime_poll(result),
            UiAction::PendingPromptReplayed(result) => self.apply_pending_prompt_replay(*result),
            UiAction::PetUpdated(pet) => {
                self.pet = pet;
                self.status_line = "Companion updated".to_string();
            }
            UiAction::Tick => {
                self.animation_frame = self.animation_frame.wrapping_add(1);
            }
            UiAction::RunCanceled(run) => {
                self.upsert_run(run);
                self.status_line = "Canceled selected conversation".to_string();
            }
            UiAction::RunDeleted(run_id) => {
                self.remove_run(&run_id);
                self.status_line = "Deleted selected conversation".to_string();
            }
            UiAction::HistoryLoaded(runs) => {
                self.runs = runs;
                self.ensure_selection_is_valid();
                self.status_line = "Loaded history".to_string();
            }
            UiAction::SelectPreviousRun => {
                self.launch_screen_visible = false;
                self.select_by_delta(-1);
            }
            UiAction::SelectNextRun => {
                self.launch_screen_visible = false;
                self.select_by_delta(1);
            }
            UiAction::SelectPreviousCommandSuggestion => self.select_command_suggestion(-1),
            UiAction::SelectNextCommandSuggestion => self.select_command_suggestion(1),
            UiAction::SelectRunAtIndex(index) => {
                self.launch_screen_visible = false;
                self.select_by_index(index);
            }
            UiAction::LoadSelectedRunIntoPrompt => {
                self.launch_screen_visible = false;
                self.load_selected_run_into_prompt();
            }
            UiAction::ToggleSidebar => {
                self.launch_screen_visible = false;
                self.toggle_sidebar();
            }
            UiAction::ToggleFocus => {
                self.launch_screen_visible = false;
                self.toggle_focus();
            }
            UiAction::ScrollDetailsUp => {
                self.launch_screen_visible = false;
                self.scroll_details(-10);
            }
            UiAction::ScrollDetailsDown => {
                self.launch_screen_visible = false;
                self.scroll_details(10);
            }
            UiAction::AppendPrompt(value) => self.append_prompt(value),
            UiAction::ApplyVoiceTranscript {
                transcript,
                replace,
            } => self.apply_voice_transcript(transcript, replace),
            UiAction::BackspacePrompt => {
                self.backspace_prompt();
            }
            UiAction::PromptSubmitRejected => {
                self.status_line = "Type a prompt before submitting".to_string();
            }
            UiAction::ServerEvent(event) => self.apply_server_event(event),
        }
    }

    fn apply_server_event(&mut self, event: AppServerEvent) {
        match event {
            AppServerEvent::RunUpdated { run } => {
                let status = format!("{:?}", run.status).to_lowercase();
                self.upsert_run(*run);
                self.status_line = format!("Conversation updated: {status}");
            }
            AppServerEvent::RunDeleted { run_id } => {
                self.remove_run(&run_id);
                self.status_line = "Conversation deleted from app-server event".to_string();
            }
            AppServerEvent::TurnStarted { thread_id, turn }
            | AppServerEvent::TurnInterrupted { thread_id, turn }
            | AppServerEvent::TurnUpdated { thread_id, turn }
            | AppServerEvent::TurnCompleted { thread_id, turn } => {
                self.upsert_turn(thread_id, *turn);
            }
            AppServerEvent::ItemStarted {
                thread_id,
                turn_id,
                item,
            }
            | AppServerEvent::ItemUpdated {
                thread_id,
                turn_id,
                item,
            }
            | AppServerEvent::ItemCompleted {
                thread_id,
                turn_id,
                item,
            } => self.upsert_thread_item(thread_id, turn_id, *item),
            AppServerEvent::ItemDelta {
                thread_id,
                turn_id,
                item_id,
                item_type,
                field,
                delta,
            } => self.apply_item_delta(thread_id, turn_id, item_id, item_type, field, delta),
            AppServerEvent::PlanUpdated {
                thread_id,
                turn_id,
                item_id,
                plan,
            } => self.apply_plan_update(thread_id, turn_id, item_id, plan),
            AppServerEvent::ThreadUpdated { thread } => self.upsert_thread(*thread),
            AppServerEvent::WorkflowRunUpdated { .. }
            | AppServerEvent::ThreadTokenUsageUpdated { .. }
            | AppServerEvent::TurnDiffUpdated { .. }
            | AppServerEvent::ProcessOutputDelta { .. }
            | AppServerEvent::ProcessExited { .. }
            | AppServerEvent::FsChanged { .. }
            | AppServerEvent::HookCompleted { .. }
            | AppServerEvent::ConfigReloaded { .. }
            | AppServerEvent::McpStartupStatusUpdated { .. }
            | AppServerEvent::McpOAuthCompleted { .. } => {}
            AppServerEvent::ServerRequest { request } => {
                if let Err(message) = self.open_interaction(request) {
                    self.command_output = Some(format!("Interaction\n{message}"));
                    self.status_line = "Unsupported interaction".to_string();
                }
            }
        }
    }
}

fn private_chat_message(enabled: bool) -> &'static str {
    if enabled {
        PRIVATE_CHAT_DISCLOSURE
    } else {
        "Private Chat disabled. Future prompts will be saved normally."
    }
}
