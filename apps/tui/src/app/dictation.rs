use std::time::{Duration, Instant};

use taskforceai_app_client::{AppClientError, AppServerRequestHandle};

use crate::state::{AppState, FocusArea, UiAction};
use crate::voice;

use super::commands::transcribe_voice_ui_action;
use super::{handle_character_input, BackgroundTaskResult, UiTaskQueue};

pub(super) enum SpaceDictationState {
    Idle,
    Pending {
        started_at: Instant,
        space_index: usize,
    },
    Recording {
        recording: voice::ActiveRecording,
    },
}

const SPACE_DICTATION_HOLD_THRESHOLD: Duration = Duration::from_millis(300);

pub(super) fn handle_space_dictation_pressed(
    state: &mut AppState,
    space_dictation: &mut SpaceDictationState,
) {
    if state.effort_selector_active() {
        return;
    }
    if state.focus != FocusArea::Prompt || state.model_selector_active() {
        handle_character_input(state, ' ');
        return;
    }
    if !matches!(space_dictation, SpaceDictationState::Idle) {
        return;
    }

    let space_index = state.prompt_cursor.min(state.prompt_input.len());
    handle_character_input(state, ' ');
    *space_dictation = SpaceDictationState::Pending {
        started_at: Instant::now(),
        space_index,
    };
    state.status_line = "Hold Space to dictate".to_string();
}

pub(super) fn handle_space_dictation_released(
    request_handle: AppServerRequestHandle,
    state: &mut AppState,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    match std::mem::replace(space_dictation, SpaceDictationState::Idle) {
        SpaceDictationState::Idle => {}
        SpaceDictationState::Pending { .. } => {
            state.status_line = "Editing prompt".to_string();
        }
        // coverage:ignore-start -- finishes a live microphone stream and sends audio to app-server.
        SpaceDictationState::Recording { recording } => {
            state.command_output = Some("Voice\nTranscribing...".to_string());
            state.status_line = "Transcribing voice".to_string();
            let audio = match recording.finish() {
                Ok(audio) => audio,
                Err(err) => {
                    state.apply(UiAction::CommandOutputDisplayed {
                        title: "Voice".to_string(),
                        message: err.to_string(),
                    });
                    return Ok(());
                }
            };
            background_tasks.push(tokio::spawn(async move {
                BackgroundTaskResult::Ui(Box::new(
                    transcribe_voice_ui_action(request_handle, audio, false).await,
                ))
            }));
        } // coverage:ignore-end
    }
    Ok(())
}

// coverage:ignore-start -- starts real microphone capture after a terminal key hold.
pub(super) fn start_space_dictation_if_due(
    state: &mut AppState,
    space_dictation: &mut SpaceDictationState,
) {
    let should_start = matches!(
        space_dictation,
        SpaceDictationState::Pending { started_at, .. }
            if started_at.elapsed() >= SPACE_DICTATION_HOLD_THRESHOLD
    );
    if !should_start {
        return;
    }

    if let SpaceDictationState::Pending { space_index, .. } = space_dictation {
        remove_pending_space(state, *space_index);
    }

    match voice::start_recording() {
        Ok(recording) => {
            *space_dictation = SpaceDictationState::Recording { recording };
            state.command_output =
                Some("Voice\nRecording... release Space to transcribe.".to_string());
            state.status_line = "Recording voice".to_string();
        }
        Err(err) => {
            *space_dictation = SpaceDictationState::Idle;
            state.apply(UiAction::CommandOutputDisplayed {
                title: "Voice".to_string(),
                message: err.to_string(),
            });
        }
    }
}
// coverage:ignore-end

pub(super) fn cancel_pending_space_dictation(space_dictation: &mut SpaceDictationState) {
    if matches!(space_dictation, SpaceDictationState::Pending { .. }) {
        *space_dictation = SpaceDictationState::Idle;
    }
}

pub(super) fn remove_pending_space(state: &mut AppState, space_index: usize) {
    if state.prompt_input.as_bytes().get(space_index) == Some(&b' ') {
        state.prompt_input.remove(space_index);
        if state.prompt_cursor > space_index {
            state.prompt_cursor = state.prompt_cursor.saturating_sub(1);
        }
    }
}
