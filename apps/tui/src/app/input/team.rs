use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    MetadataGetParams, MetadataSetParams, OrchestrationBudgetSetParams, OrchestrationRoleSetParams,
    RunModeSetParams,
};

use crate::input::InputAction;
use crate::state::AppState;

const AGENT_COUNT_METADATA_KEY: &str = "tui_orchestration_agent_count";

// coverage:ignore-start -- hydrates agent configuration through live metadata RPC.
pub(crate) async fn hydrate_agent_count(client: &AppServerClient, state: &mut AppState) {
    let result = client
        .metadata_get(MetadataGetParams {
            key: AGENT_COUNT_METADATA_KEY.to_string(),
        })
        .await;
    let Some(value) = result.ok().and_then(|result| result.value) else {
        return;
    };
    if let Ok(count) = value.parse::<u16>() {
        if (1..=16).contains(&count) {
            state.orchestration_agent_count = count;
        }
    }
}
// coverage:ignore-end

// coverage:ignore-start -- selector adapter persists model and orchestration choices through RPC.
pub(super) async fn handle_team_selector_input(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    if state.team_config_active() {
        return handle_team_config_input(client, state, action).await;
    }
    handle_agent_mode_input(client, state, action).await
}

async fn handle_agent_mode_input(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    match action {
        InputAction::Dismiss | InputAction::CancelOrQuit => {
            state.close_agent_mode_selector("Agent mode closed");
        }
        InputAction::SelectPreviousRun | InputAction::ScrollDetailsUp => {
            state.select_agent_mode_by_delta(-1);
        }
        InputAction::SelectNextRun | InputAction::ScrollDetailsDown => {
            state.select_agent_mode_by_delta(1);
        }
        InputAction::SubmitPrompt => match state.selected_agent_mode_row() {
            Some(row @ (0 | 1)) => {
                let enabled = row == 1;
                let result = client
                    .autonomous_mode_set(RunModeSetParams { enabled })
                    .await?;
                state.autonomous_mode_enabled = result.enabled;
                if let Some(selector) = &mut state.agent_mode_selector {
                    selector.selected_index = usize::from(result.enabled);
                }
                state.status_line = if result.enabled {
                    "Agent Teams selected".to_string()
                } else {
                    "Single Agent selected".to_string()
                };
            }
            Some(2) if state.autonomous_mode_enabled => {
                state.cycle_orchestration_agent_count(1);
                persist_agent_count(client, state.orchestration_agent_count).await?;
                state.status_line = format!("Parallel agents: {}", state.orchestration_agent_count);
            }
            Some(3) if state.autonomous_mode_enabled => {
                let orchestration = client.orchestration_get().await?.orchestration;
                let models = client.model_list().await?.options;
                state.open_team_config(orchestration, models);
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

async fn handle_team_config_input(
    client: &mut AppServerClient,
    state: &mut AppState,
    action: InputAction,
) -> Result<(), AppClientError> {
    match action {
        InputAction::Dismiss | InputAction::CancelOrQuit => {
            state.close_team_config("Custom orchestration canceled");
        }
        InputAction::SelectPreviousRun | InputAction::ScrollDetailsUp => {
            state.select_team_config_by_delta(-1);
        }
        InputAction::SelectNextRun | InputAction::ScrollDetailsDown => {
            state.select_team_config_by_delta(1);
        }
        InputAction::MovePromptLeft => state.adjust_team_config_selected(-1),
        InputAction::MovePromptRight => state.adjust_team_config_selected(1),
        InputAction::SubmitPrompt if state.team_config_apply_selected() => {
            apply_team_config(client, state).await?;
        }
        InputAction::SubmitPrompt => state.adjust_team_config_selected(1),
        _ => {}
    }
    Ok(())
}

async fn apply_team_config(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<(), AppClientError> {
    let Some(config) = state.team_config.clone() else {
        return Ok(());
    };
    client.orchestration_clear().await?;
    for role in &config.orchestration.roles {
        if let Some(model_id) = role.model_id.as_ref() {
            client
                .orchestration_set_role(OrchestrationRoleSetParams {
                    role: role.name.clone(),
                    model_id: model_id.clone(),
                })
                .await?;
        }
    }
    if let Some(budget) = config.orchestration.budget {
        client
            .orchestration_set_budget(OrchestrationBudgetSetParams { budget })
            .await?;
    }
    state.orchestration_agent_count = config.agent_count;
    persist_agent_count(client, config.agent_count).await?;
    state.close_team_config("Custom Agent Teams configuration applied");
    Ok(())
}

async fn persist_agent_count(client: &AppServerClient, count: u16) -> Result<(), AppClientError> {
    client
        .metadata_set(MetadataSetParams {
            key: AGENT_COUNT_METADATA_KEY.to_string(),
            value: count.to_string(),
        })
        .await?;
    Ok(())
}
// coverage:ignore-end
