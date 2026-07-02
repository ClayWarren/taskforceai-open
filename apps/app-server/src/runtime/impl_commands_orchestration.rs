use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;

impl super::AppRuntime {
    pub(crate) fn handle_orchestration_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "list".to_string());
        match action.as_str() {
            "list" | "status" => Ok(CommandExecuteResult {
                handled: true,
                title: "Orchestration".to_string(),
                message: format_orchestration_config(&self.orchestration_config()?),
            }),
            "clear" | "reset" => {
                self.orchestration_clear()?;
                Ok(CommandExecuteResult {
                    handled: true,
                    title: "Orchestration".to_string(),
                    message: "Custom orchestration config cleared.".to_string(),
                })
            }
            "budget" => {
                let Some(raw_budget) = args.get(1) else {
                    return Ok(CommandExecuteResult {
                        handled: true,
                        title: "Orchestration".to_string(),
                        message: format_orchestration_budget(self.orchestration_config()?.budget),
                    });
                };
                let budget = raw_budget
                    .parse::<f64>()
                    .map_err(|_| RuntimeError::invalid_params("budget must be a number"))?;
                self.orchestration_set_budget(OrchestrationBudgetSetParams { budget })?;
                Ok(CommandExecuteResult {
                    handled: true,
                    title: "Orchestration".to_string(),
                    message: format_orchestration_config(&self.orchestration_config()?),
                })
            }
            "set" => {
                let role = args.get(1).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /orchestrate set <role> <model-id>")
                })?;
                let model_id = args.get(2).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /orchestrate set <role> <model-id>")
                })?;
                self.orchestration_set_role(OrchestrationRoleSetParams {
                    role: (*role).to_string(),
                    model_id: (*model_id).to_string(),
                })?;
                Ok(CommandExecuteResult {
                    handled: true,
                    title: "Orchestration".to_string(),
                    message: format_orchestration_config(&self.orchestration_config()?),
                })
            }
            _ => {
                if let Some((role, model_id)) = action.split_once(':') {
                    self.orchestration_set_role(OrchestrationRoleSetParams {
                        role: role.to_string(),
                        model_id: model_id.to_string(),
                    })?;
                    return Ok(CommandExecuteResult {
                        handled: true,
                        title: "Orchestration".to_string(),
                        message: format_orchestration_config(&self.orchestration_config()?),
                    });
                }
                Ok(CommandExecuteResult {
                    handled: false,
                    title: "Orchestration".to_string(),
                    message:
                        "Usage: /orchestrate [list|set <role> <model-id>|budget <amount>|clear]"
                            .to_string(),
                })
            }
        }
    }
}
