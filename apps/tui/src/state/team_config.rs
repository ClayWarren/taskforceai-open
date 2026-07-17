use taskforceai_app_protocol::{ModelOptionRecord, OrchestrationConfig};

use super::{AgentModeSelectorState, AppState, TeamConfigState};

pub(crate) const TEAM_AGENT_COUNTS: [u16; 9] = [1, 2, 4, 6, 8, 10, 12, 14, 16];
const TEAM_BUDGETS: [Option<f64>; 6] = [
    None,
    Some(5.0),
    Some(10.0),
    Some(25.0),
    Some(50.0),
    Some(100.0),
];

impl AppState {
    pub fn agent_mode_selector_active(&self) -> bool {
        self.agent_mode_selector.is_some()
    }

    pub fn team_config_active(&self) -> bool {
        self.team_config.is_some()
    }

    pub fn open_agent_mode_selector(&mut self) {
        self.launch_screen_visible = false;
        self.effort_selector = None;
        self.team_config = None;
        self.command_output = None;
        self.clear_prompt();
        self.agent_mode_selector = Some(AgentModeSelectorState {
            selected_index: usize::from(self.autonomous_mode_enabled),
        });
        self.status_line = "Agent mode".to_string();
    }

    pub fn close_agent_mode_selector(&mut self, status: impl Into<String>) {
        self.agent_mode_selector = None;
        self.status_line = status.into();
    }

    pub fn select_agent_mode_by_delta(&mut self, delta: isize) {
        let row_count = if self.autonomous_mode_enabled { 4 } else { 2 };
        let Some(selector) = &mut self.agent_mode_selector else {
            return;
        };
        selector.selected_index = move_wrapped(selector.selected_index, delta, row_count);
    }

    pub fn selected_agent_mode_row(&self) -> Option<usize> {
        self.agent_mode_selector
            .as_ref()
            .map(|selector| selector.selected_index)
    }

    pub fn open_team_config(
        &mut self,
        orchestration: OrchestrationConfig,
        models: Vec<ModelOptionRecord>,
    ) {
        self.launch_screen_visible = false;
        self.effort_selector = None;
        self.command_output = None;
        self.team_config = Some(TeamConfigState {
            orchestration,
            models,
            default_model_id: self.current_model_id.clone(),
            agent_count: self.orchestration_agent_count,
            selected_index: 0,
        });
        self.status_line = "Custom Agent Teams configuration".to_string();
    }

    pub fn close_team_config(&mut self, status: impl Into<String>) {
        self.team_config = None;
        self.status_line = status.into();
    }

    pub fn select_team_config_by_delta(&mut self, delta: isize) {
        let Some(config) = &mut self.team_config else {
            return;
        };
        let row_count = config.visible_role_count().saturating_add(3);
        config.selected_index = move_wrapped(config.selected_index, delta, row_count);
    }

    pub fn adjust_team_config_selected(&mut self, delta: isize) {
        let Some(config) = &mut self.team_config else {
            return;
        };
        match config.selected_index {
            0 => {
                let index = TEAM_AGENT_COUNTS
                    .iter()
                    .position(|count| *count == config.agent_count)
                    .unwrap_or(2);
                config.agent_count =
                    TEAM_AGENT_COUNTS[move_wrapped(index, delta, TEAM_AGENT_COUNTS.len())];
            }
            1 => {
                let index = TEAM_BUDGETS
                    .iter()
                    .position(|budget| *budget == config.orchestration.budget)
                    .unwrap_or(0);
                config.orchestration.budget =
                    TEAM_BUDGETS[move_wrapped(index, delta, TEAM_BUDGETS.len())];
            }
            row => {
                let role_index = row.saturating_sub(2);
                let Some(role) = config.orchestration.roles.get_mut(role_index) else {
                    return;
                };
                let current = role.model_id.as_deref();
                let current_index = current
                    .and_then(|model_id| {
                        config
                            .models
                            .iter()
                            .position(|model| model.id == model_id)
                            .map(|index| index + 1)
                    })
                    .unwrap_or(0);
                let next = move_wrapped(current_index, delta, config.models.len() + 1);
                role.model_id = (next > 0).then(|| config.models[next - 1].id.clone());
            }
        }
    }

    pub fn team_config_apply_selected(&self) -> bool {
        self.team_config.as_ref().is_some_and(|config| {
            config.selected_index == config.visible_role_count().saturating_add(2)
        })
    }

    pub fn cycle_orchestration_agent_count(&mut self, delta: isize) {
        let index = TEAM_AGENT_COUNTS
            .iter()
            .position(|count| *count == self.orchestration_agent_count)
            .unwrap_or(2);
        self.orchestration_agent_count =
            TEAM_AGENT_COUNTS[move_wrapped(index, delta, TEAM_AGENT_COUNTS.len())];
    }
}

impl TeamConfigState {
    pub fn visible_role_count(&self) -> usize {
        usize::from(self.agent_count).min(self.orchestration.roles.len())
    }
}

fn move_wrapped(current: usize, delta: isize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    (current as isize + delta).rem_euclid(len as isize) as usize
}

#[cfg(test)]
mod tests {
    use taskforceai_app_protocol::{OrchestrationConfig, OrchestrationRole};

    use super::*;
    use crate::test_support::initialized;

    #[test]
    fn team_config_cycles_agent_count_budget_and_role_models() {
        let mut state = AppState::new(initialized(), Vec::new());
        state.select_agent_mode_by_delta(1);
        state.select_team_config_by_delta(1);
        state.adjust_team_config_selected(1);
        state.open_team_config(
            OrchestrationConfig {
                roles: vec![OrchestrationRole {
                    name: "Researcher".to_string(),
                    description: "Research".to_string(),
                    model_id: None,
                }],
                budget: None,
            },
            vec![taskforceai_app_protocol::ModelOptionRecord {
                id: "openai/gpt-5".to_string(),
                label: "GPT-5".to_string(),
                badge: "pro".to_string(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            }],
        );

        state.adjust_team_config_selected(1);
        assert_eq!(state.team_config.as_ref().unwrap().agent_count, 6);
        state.select_team_config_by_delta(1);
        state.adjust_team_config_selected(1);
        assert_eq!(
            state.team_config.as_ref().unwrap().orchestration.budget,
            Some(5.0)
        );
        state.select_team_config_by_delta(1);
        state.adjust_team_config_selected(1);
        assert_eq!(
            state.team_config.as_ref().unwrap().orchestration.roles[0]
                .model_id
                .as_deref(),
            Some("openai/gpt-5")
        );
        state.select_team_config_by_delta(1);
        assert!(state.team_config_apply_selected());

        state.team_config.as_mut().unwrap().selected_index = 99;
        state.adjust_team_config_selected(1);
        state.team_config.as_mut().unwrap().selected_index = 2;
        state.team_config.as_mut().unwrap().orchestration.roles[0].model_id =
            Some("missing/model".to_string());
        state.adjust_team_config_selected(1);
        assert!(state.team_config.as_ref().unwrap().orchestration.roles[0]
            .model_id
            .is_some());

        state.close_team_config("closed");
        assert!(!state.team_config_active());
        state.open_agent_mode_selector();
        state.close_agent_mode_selector("closed");
        assert!(!state.agent_mode_selector_active());
        assert_eq!(move_wrapped(4, 1, 0), 0);
    }
}
