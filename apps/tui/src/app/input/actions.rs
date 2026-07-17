use ratatui::layout::Rect;
use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::RunIDParams;

use crate::input::InputAction;
use crate::state::{AppState, FocusArea, UiAction};
use crate::ui;

use super::super::commands;
use super::super::dictation::{
    cancel_pending_space_dictation, handle_space_dictation_pressed,
    handle_space_dictation_released, SpaceDictationState,
};
use super::super::input_modes::{
    handle_character_input, queue_prompt_after_response, refresh_file_suggestions,
    toggle_autonomous_mode, toggle_computer_use_mode, toggle_quick_mode,
};
use super::{
    handle_cancel_or_quit, handle_dismiss, paste_clipboard, submit_prompt_input, UiTaskQueue,
};

// coverage:ignore-start -- top-level input action adapter dispatches live RPC, clipboard, editor, and dictation work.
pub(super) async fn handle_action(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
    terminal_area: Rect,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    match action {
        InputAction::Dismiss => handle_dismiss(client, state).await,
        InputAction::CancelOrQuit => handle_cancel_or_quit(client, state).await?,
        #[cfg(test)]
        InputAction::Quit => handle_test_quit(state),
        InputAction::ShowHelp => show_help(state),
        InputAction::OpenExternalEditor => request_external_editor(state),
        InputAction::ToggleFocus => state.apply(UiAction::ToggleFocus),
        InputAction::ToggleSidebar => state.apply(UiAction::ToggleSidebar),
        InputAction::ToggleQuickMode => toggle_quick_mode(client, state).await?,
        InputAction::ToggleAutonomousMode => toggle_autonomous_mode(client, state).await?,
        InputAction::ToggleComputerUseMode => toggle_computer_use_mode(client, state).await?,
        InputAction::ToggleRawOutput => toggle_raw_output(state),
        InputAction::ToggleToolDetails => toggle_tool_details(state),
        InputAction::CycleAgentThread => {
            commands::threads::navigate_related_thread(client, state, 1).await?;
        }
        InputAction::SubmitPrompt => submit_prompt_input(client, state, background_tasks).await?,
        InputAction::CancelSelectedRun => cancel_selected_run(client, state).await?,
        InputAction::DeleteSelectedRun => delete_selected_run(client, state).await?,
        InputAction::SelectPreviousRun => select_run_or_selector(state, -1),
        InputAction::SelectNextRun => select_run_or_selector(state, 1),
        InputAction::ScrollDetailsUp => state.apply(UiAction::ScrollDetailsUp),
        InputAction::ScrollDetailsDown => state.apply(UiAction::ScrollDetailsDown),
        InputAction::ScrollUpAt { column, row } => {
            scroll_task_pane(state, terminal_area, column, row, -1);
        }
        InputAction::ScrollDownAt { column, row } => {
            scroll_task_pane(state, terminal_area, column, row, 1);
        }
        InputAction::ClickAt { column, row } => {
            handle_click(
                client,
                state,
                terminal_area,
                column,
                row,
                background_tasks,
                space_dictation,
            )
            .await?;
        }
        InputAction::BackspacePrompt => backspace_prompt(state, space_dictation),
        InputAction::AppendPrompt(value) => {
            append_prompt(client, state, space_dictation, value).await;
        }
        InputAction::DeletePrompt => delete_prompt(client, state).await,
        InputAction::MovePromptLeft => move_prompt_horizontally(state, -1),
        InputAction::MovePromptRight => move_prompt_horizontally(state, 1),
        InputAction::MovePromptHome => state.move_prompt_home(),
        InputAction::MovePromptEnd => state.move_prompt_end(),
        InputAction::MovePromptWordLeft => state.move_prompt_word_left(),
        InputAction::MovePromptWordRight => state.move_prompt_word_right(),
        InputAction::DeletePromptWordBackward => {
            state.delete_prompt_word_backward();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::DeletePromptWordForward => {
            state.delete_prompt_word_forward();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::KillPromptLineStart => {
            state.kill_prompt_line_start();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::KillPromptLineEnd => {
            state.kill_prompt_line_end();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::YankPrompt => {
            state.yank_prompt();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::UndoPrompt => {
            state.undo_prompt();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::RedoPrompt => {
            state.redo_prompt();
            refresh_file_suggestions(client, state).await;
        }
        InputAction::InsertPromptNewline => insert_prompt_newline(state),
        InputAction::QueuePromptAfterResponse => {
            queue_prompt_after_response(client, state).await?;
        }
        InputAction::PasteClipboard => {
            cancel_pending_space_dictation(space_dictation);
            paste_clipboard(client, state).await;
            refresh_file_suggestions(client, state).await;
        }
        InputAction::PastePrompt(value) => {
            cancel_pending_space_dictation(space_dictation);
            state.paste_prompt(&value);
            refresh_file_suggestions(client, state).await;
        }
        InputAction::SpaceDictationPressed => {
            handle_space_dictation_pressed(state, space_dictation);
        }
        InputAction::SpaceDictationReleased => {
            handle_space_dictation_released(
                client.request_handle(),
                state,
                background_tasks,
                space_dictation,
            )?;
        }
    }
    Ok(())
}
// coverage:ignore-end

#[cfg(test)]
fn handle_test_quit(state: &mut AppState) {
    if state.effort_selector_active() {
        state.apply(UiAction::EffortSelectorClosed);
    } else if state.model_selector_active() {
        state.apply(UiAction::ModelSelectorClosed);
    } else {
        state.apply(UiAction::QuitRequested);
    }
}

fn show_help(state: &mut AppState) {
    state.apply(UiAction::CommandOutputDisplayed {
        title: "Keyboard shortcuts".to_string(),
        message: crate::state::commands::keyboard_help(state.task_mode),
    });
}

fn request_external_editor(state: &mut AppState) {
    state.external_editor_requested = true;
    state.status_line = "Opening external editor".to_string();
}

fn toggle_raw_output(state: &mut AppState) {
    state.raw_output_mode = !state.raw_output_mode;
    state.status_line = if state.raw_output_mode {
        "Raw output mode enabled"
    } else {
        "Raw output mode disabled"
    }
    .to_string();
}

fn toggle_tool_details(state: &mut AppState) {
    if state.task_mode == crate::state::TaskMode::Code && state.active_thread().is_some() {
        state.tool_details_expanded = !state.tool_details_expanded;
        state.status_line = if state.tool_details_expanded {
            "Expanded Code tool details"
        } else {
            "Collapsed Code tool details"
        }
        .to_string();
    } else {
        state.status_line = "Tool details are available in an active Code conversation".to_string();
    }
}

// coverage:ignore-start -- selected-run mutations are live app-server RPC adapters.
async fn cancel_selected_run(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
        state.status_line = "No selected conversation to cancel".to_string();
        return Ok(());
    };
    let canceled = client.run_cancel(RunIDParams { run_id }).await?;
    state.apply(UiAction::RunCanceled(canceled.run));
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- selected-run mutations are live app-server RPC adapters.
async fn delete_selected_run(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) else {
        state.status_line = "No selected conversation to delete".to_string();
        return Ok(());
    };
    client
        .run_delete(RunIDParams {
            run_id: run_id.clone(),
        })
        .await?;
    state.apply(UiAction::RunDeleted(run_id));
    Ok(())
}
// coverage:ignore-end

fn select_run_or_selector(state: &mut AppState, direction: isize) {
    let previous = direction < 0;
    if state.effort_selector_active() {
        state.apply(if previous {
            UiAction::SelectPreviousEffort
        } else {
            UiAction::SelectNextEffort
        });
    } else if state.model_selector_active() {
        state.apply(if previous {
            UiAction::SelectPreviousModel
        } else {
            UiAction::SelectNextModel
        });
    } else if state.command_suggestions_active() {
        state.apply(if previous {
            UiAction::SelectPreviousCommandSuggestion
        } else {
            UiAction::SelectNextCommandSuggestion
        });
    } else if state.file_suggestions_active() {
        state.select_file_suggestion(direction);
    } else if state.focus == FocusArea::Prompt && !state.prompt_history.is_empty() {
        if previous {
            state.previous_prompt_history();
        } else {
            state.next_prompt_history();
        }
    } else {
        state.apply(if previous {
            UiAction::SelectPreviousRun
        } else {
            UiAction::SelectNextRun
        });
    }
}

fn scroll_task_pane(state: &mut AppState, area: Rect, column: u16, row: u16, direction: i32) {
    match (
        ui::task_pane_at(area, column, row, state.sidebar_collapsed),
        direction < 0,
    ) {
        (Some(ui::TaskPane::Conversations), true) => state.apply(UiAction::SelectPreviousRun),
        (Some(ui::TaskPane::Conversations), false) => state.apply(UiAction::SelectNextRun),
        (Some(ui::TaskPane::Details), true) => state.apply(UiAction::ScrollDetailsUp),
        (Some(ui::TaskPane::Details), false) => state.apply(UiAction::ScrollDetailsDown),
        (None, _) => {}
    }
}

// coverage:ignore-start -- click handling may open host URLs or dispatch live app-server actions.
async fn handle_click(
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal_area: Rect,
    column: u16,
    row: u16,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    if state.effort_selector_active() {
        return Ok(());
    }
    if let Some(url) = ui::url_at(terminal_area, column, row, state) {
        state.status_line = if commands::open_url(&url).is_ok() {
            format!("Opened {url}")
        } else {
            format!("Could not open {url}")
        };
        return Ok(());
    }
    if let Some(index) = ui::run_index_at(
        terminal_area,
        column,
        row,
        state.runs.len(),
        ui::run_scroll_offset(terminal_area, state),
        state.sidebar_collapsed,
    ) {
        state.apply(UiAction::SelectRunAtIndex(index));
        return Ok(());
    }
    if let Some(action) = ui::footer_action_at(terminal_area, column, row) {
        handle_footer_action(
            client,
            state,
            terminal_area,
            action,
            background_tasks,
            space_dictation,
        )
        .await?;
    }
    Ok(())
}
// coverage:ignore-end

// coverage:ignore-start -- footer actions recurse into the live input/RPC adapter.
async fn handle_footer_action(
    client: &mut AppServerClient,
    state: &mut AppState,
    terminal_area: Rect,
    action: ui::FooterAction,
    background_tasks: &mut UiTaskQueue,
    space_dictation: &mut SpaceDictationState,
) -> Result<(), AppClientError> {
    let action = match action {
        ui::FooterAction::Submit => InputAction::SubmitPrompt,
        ui::FooterAction::Cancel => InputAction::CancelSelectedRun,
        ui::FooterAction::Delete => InputAction::DeleteSelectedRun,
        ui::FooterAction::ToggleSidebar => {
            state.apply(UiAction::ToggleSidebar);
            return Ok(());
        }
        ui::FooterAction::Dismiss => InputAction::Dismiss,
    };
    Box::pin(super::handle_input_action(
        client,
        state,
        action,
        terminal_area,
        background_tasks,
        space_dictation,
    ))
    .await
}
// coverage:ignore-end

fn backspace_prompt(state: &mut AppState, space_dictation: &mut SpaceDictationState) {
    cancel_pending_space_dictation(space_dictation);
    if !state.effort_selector_active() {
        state.apply(UiAction::BackspacePrompt);
    }
}

// coverage:ignore-start -- prompt edits refresh live workspace file suggestions over RPC.
async fn append_prompt(
    client: &AppServerClient,
    state: &mut AppState,
    space_dictation: &mut SpaceDictationState,
    value: char,
) {
    cancel_pending_space_dictation(space_dictation);
    if !state.effort_selector_active() {
        handle_character_input(state, value);
        refresh_file_suggestions(client, state).await;
    }
}

async fn delete_prompt(client: &AppServerClient, state: &mut AppState) {
    if !state.effort_selector_active() {
        state.delete_prompt();
        refresh_file_suggestions(client, state).await;
    }
}
// coverage:ignore-end

fn move_prompt_horizontally(state: &mut AppState, direction: i32) {
    match (state.effort_selector_active(), direction < 0) {
        (true, true) => state.apply(UiAction::SelectPreviousEffort),
        (true, false) => state.apply(UiAction::SelectNextEffort),
        (false, true) => state.move_prompt_left(),
        (false, false) => state.move_prompt_right(),
    }
}

fn insert_prompt_newline(state: &mut AppState) {
    if !state.effort_selector_active() {
        state.insert_prompt_newline();
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use taskforceai_app_protocol::ModelOptionRecord;

    use super::*;
    use crate::state::{EffortSelectorState, ModelSelectorState};
    use crate::test_support::initialized;

    fn state() -> AppState {
        AppState::new(initialized(), Vec::new())
    }

    fn effort_selector() -> EffortSelectorState {
        EffortSelectorState {
            model_id: "model".to_string(),
            levels: vec!["low".to_string(), "high".to_string()],
            selected_index: 0,
        }
    }

    #[test]
    fn local_actions_cover_help_editor_toggles_and_test_quit() {
        let mut state = state();
        show_help(&mut state);
        assert!(state
            .command_output
            .as_deref()
            .is_some_and(|text| text.contains("Keyboard")));

        request_external_editor(&mut state);
        assert!(state.external_editor_requested);
        toggle_raw_output(&mut state);
        toggle_raw_output(&mut state);
        assert!(!state.raw_output_mode);
        toggle_tool_details(&mut state);
        assert!(state.status_line.contains("active Code"));
        state.set_active_thread(
            serde_json::from_value(serde_json::json!({
                "id":"code", "title":"Code", "objective":"", "state":"active",
                "archived":false, "source":"test", "taskMode":"code", "parentThreadId":null,
                "turns":[], "createdAt":1, "updatedAt":1
            }))
            .expect("code thread"),
        );
        toggle_tool_details(&mut state);
        toggle_tool_details(&mut state);
        assert_eq!(state.status_line, "Collapsed Code tool details");

        state.effort_selector = Some(effort_selector());
        handle_test_quit(&mut state);
        state.model_selector = Some(ModelSelectorState {
            options: Vec::new(),
            default_model_id: "model".to_string(),
            selected_model_id: None,
            selected_index: 0,
            remote_catalog: false,
        });
        handle_test_quit(&mut state);
        handle_test_quit(&mut state);
        assert!(state.should_quit);
    }

    #[test]
    fn selection_and_scrolling_cover_every_surface() {
        let mut state = state();
        state.effort_selector = Some(effort_selector());
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);
        state.effort_selector = None;

        state.model_selector = Some(ModelSelectorState {
            options: vec![ModelOptionRecord {
                id: "model".to_string(),
                label: "Model".to_string(),
                badge: String::new(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            }],
            default_model_id: "model".to_string(),
            selected_model_id: None,
            selected_index: 0,
            remote_catalog: false,
        });
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);
        state.model_selector = None;

        state.command_suggestions = vec!["/help"];
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);
        state.command_suggestions.clear();
        state.file_suggestions = vec!["file.rs".to_string()];
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);
        state.file_suggestions.clear();
        state.prompt_history = vec!["old prompt".to_string()];
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);
        state.prompt_history.clear();
        select_run_or_selector(&mut state, -1);
        select_run_or_selector(&mut state, 1);

        state.sidebar_collapsed = false;
        let area = Rect::new(0, 0, 120, 30);
        scroll_task_pane(&mut state, area, 1, 5, -1);
        scroll_task_pane(&mut state, area, 1, 5, 1);
        scroll_task_pane(&mut state, area, 50, 5, -1);
        scroll_task_pane(&mut state, area, 50, 5, 1);
        scroll_task_pane(&mut state, area, 1, 1, 1);
    }

    #[test]
    fn pure_prompt_actions_cover_selector_and_composer_paths() {
        let mut state = state();
        state.prompt_input = "ab".to_string();
        state.prompt_cursor = 2;
        let mut dictation = SpaceDictationState::Pending {
            started_at: Instant::now(),
            space_index: 1,
        };
        backspace_prompt(&mut state, &mut dictation);
        assert!(matches!(dictation, SpaceDictationState::Idle));

        move_prompt_horizontally(&mut state, -1);
        move_prompt_horizontally(&mut state, 1);
        insert_prompt_newline(&mut state);
        assert!(state.prompt_input.contains('\n'));

        state.effort_selector = Some(effort_selector());
        backspace_prompt(&mut state, &mut dictation);
        move_prompt_horizontally(&mut state, -1);
        move_prompt_horizontally(&mut state, 1);
        insert_prompt_newline(&mut state);
    }
}
