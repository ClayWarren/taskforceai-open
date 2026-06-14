use std::time::{Duration, Instant};

use taskforceai_app_protocol::{
    AppServerEvent, DeviceLoginPollResult, DeviceLoginStartResult, ModelListResult,
    PendingPromptReplayResult, RunRecord, SyncRealtimePollResult,
};

use super::{AppState, PendingLogin};

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
    CommandExecuted { title: String, message: String },
    CommandOutputDisplayed { title: String, message: String },
    LoginStarted(DeviceLoginStartResult),
    LoginPolled(DeviceLoginPollResult),
    SyncRealtimePolled(SyncRealtimePollResult),
    PendingPromptReplayed(PendingPromptReplayResult),
    SelectPreviousRun,
    SelectNextRun,
    SelectPreviousCommandSuggestion,
    SelectNextCommandSuggestion,
    SelectRunAtIndex(usize),
    LoadSelectedRunIntoPrompt,
    ToggleFocus,
    ScrollDetailsUp,
    ScrollDetailsDown,
    AppendPrompt(char),
    ApplyVoiceTranscript { transcript: String, replace: bool },
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
                self.prompt_input.clear();
                self.refresh_command_suggestions();
                self.command_output = None;
                self.model_selector = None;
                self.status_line = "Cleared".to_string();
            }
            UiAction::NewPrompt => {
                self.prompt_input.clear();
                self.refresh_command_suggestions();
                self.command_output = None;
                self.model_selector = None;
                self.selected_run_id = None;
                self.status_line = "New prompt".to_string();
            }
            UiAction::RunSubmitted(run) => {
                self.upsert_run(run);
                self.prompt_input.clear();
                self.refresh_command_suggestions();
                self.command_output = None;
                self.model_selector = None;
                self.status_line = "Submitted run".to_string();
            }
            UiAction::CommandExecuted { title, message } => {
                self.prompt_input.clear();
                self.refresh_command_suggestions();
                self.model_selector = None;
                self.command_output = Some(format!("{title}\n{message}"));
                self.status_line = format!("Command executed: {title}");
            }
            UiAction::CommandOutputDisplayed { title, message } => {
                self.model_selector = None;
                self.command_output = Some(format!("{title}\n{message}"));
                self.status_line = format!("Command executed: {title}");
            }
            UiAction::ModelSelectorOpened(result) => {
                self.open_model_selector(result);
            }
            UiAction::ModelSelectorClosed => {
                self.model_selector = None;
                self.status_line = "Model selector closed".to_string();
            }
            UiAction::SelectPreviousModel => self.select_model_by_delta(-1),
            UiAction::SelectNextModel => self.select_model_by_delta(1),
            UiAction::LoginStarted(result) => {
                let interval = Duration::from_secs(result.interval.max(1) as u64);
                let now = Instant::now();
                self.pending_login = Some(PendingLogin {
                    device_code: result.device_code.clone(),
                    expires_at: now + Duration::from_secs(result.expires_in.max(1) as u64),
                    next_poll_at: now + interval,
                    interval,
                });
                self.prompt_input.clear();
                self.refresh_command_suggestions();
                self.command_output = Some(format!(
                    "Login\nOpen {}\nEnter code {}\nWaiting for browser approval...",
                    result.verification_uri, result.user_code
                ));
                self.status_line = "Waiting for login approval".to_string();
            }
            UiAction::LoginPolled(result) => self.apply_login_poll(result),
            UiAction::SyncRealtimePolled(result) => self.apply_sync_realtime_poll(result),
            UiAction::PendingPromptReplayed(result) => self.apply_pending_prompt_replay(result),
            UiAction::PetUpdated(pet) => {
                self.pet = pet;
                self.status_line = "Companion updated".to_string();
            }
            UiAction::Tick => {
                self.animation_frame = self.animation_frame.wrapping_add(1);
            }
            UiAction::RunCanceled(run) => {
                self.upsert_run(run);
                self.status_line = "Canceled selected run".to_string();
            }
            UiAction::RunDeleted(run_id) => {
                self.remove_run(&run_id);
                self.status_line = "Deleted selected run".to_string();
            }
            UiAction::HistoryLoaded(runs) => {
                self.runs = runs;
                self.ensure_selection_is_valid();
                self.status_line = "Loaded history".to_string();
            }
            UiAction::SelectPreviousRun => self.select_by_delta(-1),
            UiAction::SelectNextRun => self.select_by_delta(1),
            UiAction::SelectPreviousCommandSuggestion => self.select_command_suggestion(-1),
            UiAction::SelectNextCommandSuggestion => self.select_command_suggestion(1),
            UiAction::SelectRunAtIndex(index) => self.select_by_index(index),
            UiAction::LoadSelectedRunIntoPrompt => self.load_selected_run_into_prompt(),
            UiAction::ToggleFocus => self.toggle_focus(),
            UiAction::ScrollDetailsUp => self.scroll_details(-10),
            UiAction::ScrollDetailsDown => self.scroll_details(10),
            UiAction::AppendPrompt(value) => self.append_prompt(value),
            UiAction::ApplyVoiceTranscript {
                transcript,
                replace,
            } => self.apply_voice_transcript(transcript, replace),
            UiAction::BackspacePrompt => {
                self.prompt_input.pop();
                self.refresh_command_suggestions();
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
                self.status_line = format!("Run updated: {status}");
            }
            AppServerEvent::RunDeleted { run_id } => {
                self.remove_run(&run_id);
                self.status_line = "Run deleted from app-server event".to_string();
            }
            AppServerEvent::TurnStarted { .. } | AppServerEvent::TurnInterrupted { .. } => {}
            AppServerEvent::WorkflowRunUpdated { .. } => {}
        }
    }
}
