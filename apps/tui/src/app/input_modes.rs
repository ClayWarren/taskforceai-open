use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{PromptQueueRecord, QuickModeSetParams, RunModeSetParams};

use crate::prompt_history;
use crate::state::{AppState, FocusArea, UiAction};

pub(super) async fn select_highlighted_model(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(model_id) = state
        .selected_model_option()
        .map(|option| option.id.clone())
    else {
        state.apply(UiAction::ModelSelectorClosed);
        return Ok(());
    };
    let result = client
        .model_select(taskforceai_app_protocol::ModelSelectParams {
            model_id: model_id.clone(),
        })
        .await?;
    let current_model = result
        .selected_model_id
        .clone()
        .unwrap_or_else(|| result.default_model_id.clone());
    state.set_current_model(current_model);
    state.apply(UiAction::CommandExecuted {
        title: "Model".to_string(),
        message: format!("Selected {model_id}."),
    });
    Ok(())
}

pub(super) fn handle_character_input(state: &mut AppState, value: char) {
    if state.focus == FocusArea::Runs && state.prompt_input.is_empty() {
        match value {
            'q' => state.apply(UiAction::QuitRequested),
            'k' => state.apply(UiAction::SelectPreviousRun),
            'j' => state.apply(UiAction::SelectNextRun),
            _ => state.apply(UiAction::AppendPrompt(value)),
        }
        return;
    }
    state.apply(UiAction::AppendPrompt(value));
}

pub(super) async fn refresh_file_suggestions(client: &AppServerClient, state: &mut AppState) {
    if state.task_mode != crate::state::TaskMode::Code {
        state.set_file_suggestions(Vec::new());
        return;
    }
    let Some(query) = state.mention_query().map(ToOwned::to_owned) else {
        state.set_file_suggestions(Vec::new());
        return;
    };
    match client
        .workspace_file_list(taskforceai_app_protocol::WorkspaceFileListParams {
            workspace: state.workspace.clone(),
            query: (!query.is_empty()).then_some(query),
            limit: Some(30),
        })
        .await
    {
        Ok(result) => state.set_file_suggestions(result.files),
        Err(_) => state.set_file_suggestions(Vec::new()),
    }
}

pub(super) async fn queue_prompt_after_response(
    client: &AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let prompt = state.prompt_input.trim().to_string();
    if prompt.is_empty() {
        state.apply(UiAction::PromptSubmitRejected);
        return Ok(());
    }
    let conversation_id = state
        .active_turn()
        .map(|turn| turn.run_id.clone())
        .filter(|run_id| !run_id.is_empty())
        .or_else(|| state.selected_run_id().map(ToOwned::to_owned));
    let Some(conversation_id) = conversation_id else {
        state.status_line = "Start a task before queueing a follow-up".to_string();
        return Ok(());
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    prompt_history::record_and_persist(client, state, &prompt).await;
    let result = client
        .prompt_queue_add(PromptQueueRecord {
            id: None,
            conversation_id,
            prompt,
            status: "queued".to_string(),
            dispatch_timing: "after_response".to_string(),
            created_at: now,
            updated_at: now,
            model_id: Some(state.current_model_id.clone()),
            reasoning_effort: state.reasoning_effort.clone(),
            attachment_ids: state
                .attachments
                .iter()
                .map(|attachment| attachment.id.clone())
                .collect(),
        })
        .await?;
    let _ = client.attachment_clear().await;
    state.attachments.clear();
    state.clear_prompt();
    state.status_line = format!(
        "Queued follow-up {} for after the current response",
        result.queued_prompt.id.unwrap_or_default()
    );
    Ok(())
}

pub(super) async fn toggle_quick_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.quick_mode_get().await?;
    let result = client
        .quick_mode_set(QuickModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.quick_mode_enabled = result.enabled;
    state.status_line = if result.enabled {
        "Direct Chat enabled".to_string()
    } else {
        "Direct Chat disabled".to_string()
    };
    Ok(())
}

pub(super) async fn toggle_autonomous_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.autonomous_mode_get().await?;
    let result = client
        .autonomous_mode_set(RunModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.autonomous_mode_enabled = result.enabled;
    state.status_line = if result.enabled {
        "Autonomous Mode enabled".to_string()
    } else {
        "Autonomous Mode disabled".to_string()
    };
    Ok(())
}

pub(super) async fn toggle_computer_use_mode(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let current = client.computer_use_mode_get().await?;
    let result = client
        .computer_use_mode_set(RunModeSetParams {
            enabled: !current.enabled,
        })
        .await?;
    state.computer_use_enabled = result.enabled;
    state.status_line = if result.enabled {
        "Computer Use enabled".to_string()
    } else {
        "Computer Use disabled".to_string()
    };
    Ok(())
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    use taskforceai_app_protocol::ModelListResult;

    #[tokio::test]
    async fn selecting_from_an_empty_model_list_closes_the_selector() {
        let mut client = AppServerClient::connect_http("http://127.0.0.1:9", "test")
            .expect("client construction");
        let mut state = AppState::new(crate::test_support::initialized(), Vec::new());
        state.apply(UiAction::ModelSelectorOpened(ModelListResult {
            enabled: true,
            options: Vec::new(),
            default_model_id: "default".to_string(),
            selected_model_id: None,
            remote_catalog: false,
        }));
        select_highlighted_model(&mut client, &mut state)
            .await
            .expect("empty selection closes without RPC");
        assert!(!state.model_selector_active());
    }
}
