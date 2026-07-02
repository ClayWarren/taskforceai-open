use crate::protocol::*;

use super::error::RuntimeError;

impl super::AppRuntime {
    pub(crate) fn handle_quick_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let current = self.quick_mode_enabled()?;
        let next = match args.first().map(|value| value.to_ascii_lowercase()) {
            None => !current,
            Some(value) if matches!(value.as_str(), "on" | "enable" | "true" | "1") => true,
            Some(value) if matches!(value.as_str(), "off" | "disable" | "false" | "0") => false,
            Some(value) if value == "status" => current,
            Some(_) => {
                return Ok(CommandExecuteResult {
                    handled: false,
                    title: "Direct Chat".to_string(),
                    message: "Usage: /direct [on|off|status]".to_string(),
                });
            }
        };
        if next != current {
            self.set_metadata_value("quick_mode", if next { "true" } else { "false" })?;
        }
        let status = if next { "on" } else { "off" };
        Ok(CommandExecuteResult {
            handled: true,
            title: "Direct Chat".to_string(),
            message: format!("Direct chat is {status}."),
        })
    }
}
