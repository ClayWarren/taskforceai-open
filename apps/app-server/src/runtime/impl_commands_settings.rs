use crate::protocol::*;

use super::error::RuntimeError;
use super::settings_util::*;
use super::util::*;

impl super::AppRuntime {
    pub(crate) async fn handle_settings_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let area = args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "summary".to_string());
        match area.as_str() {
            "summary" | "local" => Ok(command_message(
                "Settings",
                format_local_settings(&self.local_settings()?),
            )),
            "theme" => self.handle_theme_settings(&args[1..]),
            "telemetry" => self.handle_telemetry_settings(&args[1..]),
            "logging" => self.handle_logging_settings(&args[1..]),
            "model" => self.handle_model_command(&["status"]),
            "mcp" => self.handle_mcp_command(&[]).await,
            "account" | "notifications" | "personalization" | "subscription" | "data" | "apps" => {
                if self.auth_token()?.is_none() {
                    return Ok(command_unhandled(
                        "Settings",
                        format!(
                            "/settings {area} requires the authenticated product settings adapter"
                        ),
                    ));
                    // coverage:ignore-start
                }
                let string_args = args
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect::<Vec<_>>();
                from_value_response(
                    self.remote_settings_command(RemoteSettingsCommandParams {
                        area,
                        args: string_args,
                    })
                    .await?,
                    // coverage:ignore-end
                )
            }
            _ => Ok(command_unhandled(
                "Settings",
                "Usage: /settings [theme|telemetry|logging|model|mcp]",
            )),
        }
    }
    pub(crate) async fn handle_config_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            return Ok(command_message(
                "Config",
                format_local_settings(&self.local_settings()?),
            ));
        }
        self.handle_settings_command(args).await
    }

    pub(crate) fn handle_theme_settings(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            return Ok(command_message(
                "Settings",
                format!("Theme: {}", self.local_settings()?.theme),
            ));
        }
        let settings = self.local_settings_update(LocalSettingsUpdateParams {
            theme: Some(args[0].to_string()),
            ..Default::default()
        })?; // coverage:ignore-line
        let AppResponse::Value(value) = settings else {
            unreachable!("local_settings_update returns a value response"); // coverage:ignore-line
        };
        Ok(command_message(
            "Settings",
            format!(
                "Theme set to {}.",
                value["settings"]["theme"].as_str().unwrap_or("system")
            ),
        ))
    }

    pub(crate) fn handle_telemetry_settings(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            let settings = self.local_settings()?;
            return Ok(command_message(
                "Settings",
                format!(
                    "Telemetry: {}\nDSN: {}\nEnvironment: {}",
                    on_off(settings.telemetry_enabled),
                    mask_sensitive(&settings.telemetry_dsn),
                    settings.telemetry_environment
                ),
            ));
        }
        let action = args[0].to_ascii_lowercase();
        let update = match action.as_str() {
            "on" | "off" => LocalSettingsUpdateParams {
                telemetry_enabled: Some(action == "on"),
                ..Default::default()
            },
            "dsn" => LocalSettingsUpdateParams {
                telemetry_dsn: Some(args.get(1..).unwrap_or_default().join(" ")),
                ..Default::default()
            },
            "env" => LocalSettingsUpdateParams {
                telemetry_environment: Some(args.get(1).copied().unwrap_or("cli").to_string()),
                ..Default::default()
            },
            _ => {
                return Ok(command_unhandled(
                    "Settings",
                    "Usage: /settings telemetry <on|off|dsn|env>",
                ))
            }
        };
        self.local_settings_update(update)?;
        Ok(command_message("Settings", "Telemetry settings updated."))
    }
}
