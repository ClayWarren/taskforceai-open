use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::util::*;

impl crate::runtime::AppRuntime {
    pub fn not_configured(&self, feature: &'static str) -> Result<AppResponse, RuntimeError> {
        Err(RuntimeError::not_configured(format!(
            "{feature} is not wired yet"
        )))
    }

    pub(crate) fn default_model_id(&self) -> Result<Option<String>, RuntimeError> {
        Ok(self
            .metadata_value("default_model_id")?
            .filter(|value| !value.trim().is_empty()))
    }

    pub(crate) fn quick_mode_enabled(&self) -> Result<bool, RuntimeError> {
        let Some(value) = self.metadata_value("quick_mode")? else {
            return Ok(true);
        };
        Ok(!matches!(
            value.as_str(),
            "false" | "0" | "off" | "disabled"
        ))
    }

    pub(crate) fn autonomous_enabled(&self) -> Result<bool, RuntimeError> {
        Ok(matches!(
            self.metadata_value("autonomous_mode")?.as_deref(),
            Some("true" | "1" | "on" | "enabled")
        ))
    }

    pub(crate) fn computer_use_enabled(&self) -> Result<bool, RuntimeError> {
        Ok(matches!(
            self.metadata_value("computer_use_mode")?.as_deref(),
            Some("true" | "1" | "on" | "enabled")
        ))
    }

    pub(crate) fn active_project_id(&self) -> Result<Option<i64>, RuntimeError> {
        self.metadata_value("active_project_id")?
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .parse::<i64>()
                    .map_err(|err| RuntimeError::storage(err.to_string()))
            })
            .transpose()
    }

    pub(crate) fn goal_record(&self) -> Result<Option<GoalRecord>, RuntimeError> {
        let Some(raw) = self.metadata_value("goal_state")? else {
            return Ok(None);
        };
        if raw.trim().is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))
    }

    pub(crate) fn set_goal(&mut self, objective: &str) -> Result<GoalRecord, RuntimeError> {
        let objective = objective.trim();
        if objective.is_empty() {
            return Err(RuntimeError::invalid_params("goal objective is required"));
        }

        let now = unix_millis();
        let created_at = self
            .goal_record()?
            .map(|goal| goal.created_at)
            .unwrap_or(now);
        let goal = GoalRecord {
            objective: objective.to_string(),
            status: GoalStatus::Active,
            created_at,
            updated_at: now,
        };
        self.save_goal(&goal)?;
        Ok(goal)
    }

    pub(crate) fn update_goal_status(
        &mut self,
        status: GoalStatus,
    ) -> Result<Option<GoalRecord>, RuntimeError> {
        let Some(mut goal) = self.goal_record()? else {
            return Ok(None);
        };
        goal.status = status;
        goal.updated_at = unix_millis();
        self.save_goal(&goal)?;
        Ok(Some(goal))
    }

    pub(crate) fn save_goal(&mut self, goal: &GoalRecord) -> Result<(), RuntimeError> {
        let serialized =
            serde_json::to_string(goal).map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("goal_state", &serialized)
    }

    pub(crate) fn clear_goal(&mut self) -> Result<(), RuntimeError> {
        self.set_metadata_value("goal_state", "")
    }
}
