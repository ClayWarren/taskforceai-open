use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{ThreadIDParams, ThreadRollbackParams};

use crate::input::InputAction;
use crate::state::{AppState, PickerKind};

use super::commands;

// coverage:ignore-start -- picker adapter may resume/rollback threads or persist themes through IO/RPC.
pub(super) async fn handle_picker_input(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    match action {
        InputAction::Dismiss | InputAction::CancelOrQuit => cancel_picker(state),
        #[cfg(test)]
        InputAction::Quit => cancel_picker(state),
        InputAction::SelectPreviousRun | InputAction::MovePromptLeft => {
            state.select_picker_by_delta(-1);
            preview_picker_theme(state);
        }
        InputAction::SelectNextRun | InputAction::MovePromptRight => {
            state.select_picker_by_delta(1);
            preview_picker_theme(state);
        }
        InputAction::SubmitPrompt => submit_picker_selection(client, state).await?,
        InputAction::BackspacePrompt => {
            state.backspace_picker_query();
            preview_picker_theme(state);
        }
        InputAction::AppendPrompt(value) => {
            state.append_picker_query(value);
            preview_picker_theme(state);
        }
        InputAction::PastePrompt(value) => {
            state.paste_picker_query(&value);
            preview_picker_theme(state);
        }
        InputAction::PasteClipboard => {
            if let Ok(crate::clipboard::ClipboardContent::Text(value)) = crate::clipboard::read() {
                state.paste_picker_query(&value);
                preview_picker_theme(state);
            }
        }
        _ => {}
    }
    Ok(())
}

async fn submit_picker_selection(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(kind) = state.picker_kind() else {
        return Ok(());
    };
    let Some(value) = state
        .selected_picker_option()
        .map(|option| option.value.clone())
    else {
        state.status_line = "No matching picker option".to_string();
        return Ok(());
    };
    match kind {
        PickerKind::Resume => {
            let resumed = client
                .thread_resume(ThreadIDParams { thread_id: value })
                .await?;
            let title = resumed.thread.title.clone();
            state.set_active_thread(resumed.thread);
            state.close_picker(format!("Resumed {title}"));
        }
        PickerKind::Rollback => {
            let Some(thread_id) = state.active_thread_id.clone() else {
                state.close_picker("Rollback closed because no thread is active");
                return Ok(());
            };
            let rolled_back = client
                .thread_rollback(ThreadRollbackParams {
                    thread_id,
                    turn_id: value,
                })
                .await?;
            state.set_active_thread(rolled_back.thread);
            state.close_picker("Rolled back to the selected turn");
        }
        PickerKind::Theme => match commands::features::apply_theme(state, &value, true) {
            Ok(name) => state.close_picker(format!("Applied and saved {name}")),
            Err(error) => state.status_line = error,
        },
    }
    Ok(())
}
// coverage:ignore-end

fn preview_picker_theme(state: &mut AppState) {
    if state.picker_kind() != Some(PickerKind::Theme) {
        return;
    }
    let Some(value) = state
        .selected_picker_option()
        .map(|option| option.value.clone())
    else {
        return;
    };
    if let Err(error) = commands::features::apply_theme(state, &value, false) {
        state.status_line = error;
    }
}

pub(super) fn cancel_picker(state: &mut AppState) {
    if state.picker_kind() == Some(PickerKind::Theme) {
        let original = state
            .picker
            .as_ref()
            .and_then(|picker| picker.original_theme.clone());
        if let Some(original) = original {
            let _ = commands::features::apply_theme(state, &original, false);
        }
    }
    state.close_picker("Picker closed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PickerOption;
    use crate::test_support::initialized;

    fn state() -> AppState {
        AppState::new(initialized(), Vec::new())
    }

    #[test]
    fn theme_preview_covers_non_theme_empty_valid_and_invalid_options() {
        let mut state = state();
        preview_picker_theme(&mut state);
        state.open_picker(
            PickerKind::Resume,
            "Resume",
            vec![PickerOption::new("id", "Title", "detail", "search")],
            None,
        );
        preview_picker_theme(&mut state);

        state.open_picker(PickerKind::Theme, "Theme", Vec::new(), None);
        preview_picker_theme(&mut state);
        state.open_picker(
            PickerKind::Theme,
            "Theme",
            vec![
                PickerOption::new("nord", "Nord", "built in", "nord"),
                PickerOption::new("missing-theme", "Missing", "invalid", "missing"),
            ],
            None,
        );
        preview_picker_theme(&mut state);
        state.select_picker_by_delta(1);
        preview_picker_theme(&mut state);
        assert!(state.status_line.contains("Could not read"));
    }

    #[test]
    fn cancel_theme_restores_original_and_other_pickers_close_directly() {
        let mut state = state();
        cancel_picker(&mut state);
        state.open_picker(
            PickerKind::Theme,
            "Theme",
            vec![PickerOption::new("light", "Light", "built in", "light")],
            Some("taskforce-dark".to_string()),
        );
        cancel_picker(&mut state);
        assert_eq!(state.theme_name, "taskforce-dark");

        state.open_picker(PickerKind::Resume, "Resume", Vec::new(), None);
        cancel_picker(&mut state);
        assert_eq!(state.status_line, "Picker closed");
    }
}
