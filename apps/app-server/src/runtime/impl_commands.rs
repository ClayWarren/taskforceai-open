use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::util::*;
use super::{MockServerHandle, MOCK_SERVER_PORT};

impl super::AppRuntime {
    pub async fn command_execute(
        &mut self,
        params: CommandExecuteParams,
    ) -> Result<AppResponse, RuntimeError> {
        let input = params.input.trim();
        if !input.starts_with('/') {
            return Err(RuntimeError::invalid_params("command must start with /"));
        }

        let mut parts = input[1..].split_whitespace();
        let command = parts.next().unwrap_or_default().to_ascii_lowercase();
        let args = parts.collect::<Vec<_>>();
        let result = match command.as_str() {
            "help" => CommandExecuteResult {
                handled: true,
                title: "Help".to_string(),
                message: command_help_message(),
            },
            "status" => CommandExecuteResult {
                handled: true,
                title: "Status".to_string(),
                message: format_status_summary(&self.status_summary_result()?),
            },
            "usage" => CommandExecuteResult {
                handled: true,
                title: "Usage".to_string(),
                message: format_usage_summary(&self.usage_summary_result()),
            },
            "account" => self.handle_account_usage_command().await?,
            "search" => CommandExecuteResult {
                handled: true,
                title: "Search".to_string(),
                message: search_message(self.runs.values(), &args.join(" ")),
            },
            "goal" => self.handle_goal_command(input.strip_prefix("/goal").unwrap_or_default())?,
            "agents" | "agent" => self.handle_agents_command(&args)?,
            "inspect" | "doctor" => CommandExecuteResult {
                handled: true,
                title: "Inspect".to_string(),
                message: format_diagnostics(self.diagnostics_inspect_result()?),
            },
            "channel" | "channels" => self.handle_channel_command(&args)?,
            "schedule" | "schedules" => self.handle_schedule_command(&args)?,
            "workflow" | "workflows" => self.handle_workflow_command(&args).await?,
            "pet" | "companion" => self.handle_pet_command(&args)?,
            "skills" | "skill" => CommandExecuteResult {
                handled: true,
                title: "Skills".to_string(),
                message: format_skills(self.discover_skills()?.skills),
            },
            "plugins" | "plugin" => self.handle_plugin_command(&args)?,
            "computer" | "computer-use" => CommandExecuteResult {
                handled: true,
                title: "Computer Use".to_string(),
                message: self.computer_use_status_message(),
            },
            "browser" | "in-app-browser" => CommandExecuteResult {
                handled: true,
                title: "Browser".to_string(),
                message: self.browser_status_message(),
            },
            "mcp" => self.handle_mcp_command(&args).await?,
            "pending" | "queue" => self.handle_pending_command(&args).await?,
            "prompt-queue" => self.handle_prompt_queue_command(&args).await?,
            "pending-changes" => self.handle_pending_changes_command(&args)?,
            "attach" | "attachment" | "attachments" => {
                self.handle_attachment_command(&args).await?
            }
            "project" | "projects" => self.handle_project_command(&args).await?,
            "context" => CommandExecuteResult {
                handled: true,
                title: "Context".to_string(),
                message: format_context_summary(self.context_summary_result()),
            },
            "memory" => CommandExecuteResult {
                handled: true,
                title: "Memory".to_string(),
                message: format_memory_summary(self.memory_summary_result()),
            },
            "direct" | "quick" => self.handle_quick_command(&args)?,
            "model" => self.handle_model_command(&args)?,
            "settings" => self.handle_settings_command(&args).await?,
            "config" => self.handle_config_command(&args).await?,
            "logout" => {
                self.set_auth_token(None)?;
                CommandExecuteResult {
                    handled: true,
                    title: "Logout".to_string(),
                    message: "Cached auth token cleared.".to_string(),
                }
            }
            "orchestrate" | "orchestration" => self.handle_orchestration_command(&args)?,
            "sync" => self.handle_sync_command(&args).await?,
            "clear" => CommandExecuteResult {
                handled: true,
                title: "Clear".to_string(),
                message: "Cleared the current client view.".to_string(),
            },
            "new" => CommandExecuteResult {
                handled: true,
                title: "New".to_string(),
                message: "Started a new client prompt.".to_string(),
            },
            "reset-local" | "reset" => {
                self.metadata_clear_all()?;
                CommandExecuteResult {
                    handled: true,
                    title: "Local Storage".to_string(),
                    message: "Cleared local conversations, messages, pending queues, and metadata."
                        .to_string(),
                }
            }
            "mock" => self.handle_mock_command()?,
            "login" | "upgrade" => CommandExecuteResult {
                handled: false,
                title: command.to_string(),
                message: format!("/{command} is reserved for a desktop/app-server adapter"),
            },
            "exit" | "quit" => CommandExecuteResult {
                handled: true,
                title: "Exit".to_string(),
                message: "Use Esc or Ctrl-C to quit the Rust TUI.".to_string(),
            },
            "" => CommandExecuteResult {
                handled: false,
                title: "Command".to_string(),
                message: "Type /help for commands.".to_string(),
            },
            _ => CommandExecuteResult {
                handled: false,
                title: "Unknown command".to_string(),
                message: format!("Unknown command /{command}. Type /help for commands."),
            },
        };

        Ok(value(result))
    }

    pub(crate) fn handle_plugin_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "list".to_string());
        let result = match action.as_str() {
            "list" | "ls" | "status" => self.discover_plugins()?,
            "enable" | "on" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                if plugin_id.trim().is_empty() {
                    return Ok(CommandExecuteResult {
                        handled: false,
                        title: "Plugins".to_string(),
                        message: "Usage: /plugins enable <plugin-id>".to_string(),
                    });
                }
                from_value_response(self.plugin_set_enabled(PluginSetEnabledParams {
                    plugin_id: plugin_id.trim().to_string(),
                    enabled: true,
                })?)?
            }
            "disable" | "off" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                if plugin_id.trim().is_empty() {
                    return Ok(CommandExecuteResult {
                        handled: false,
                        title: "Plugins".to_string(),
                        message: "Usage: /plugins disable <plugin-id>".to_string(),
                    });
                }
                from_value_response(self.plugin_set_enabled(PluginSetEnabledParams {
                    plugin_id: plugin_id.trim().to_string(),
                    enabled: false,
                })?)?
            }
            _ => {
                return Ok(CommandExecuteResult {
                    handled: false,
                    title: "Plugins".to_string(),
                    message: "Usage: /plugins [list|enable <plugin-id>|disable <plugin-id>]"
                        .to_string(),
                });
            }
        };
        Ok(CommandExecuteResult {
            handled: true,
            title: "Plugins".to_string(),
            message: format_plugins(result.plugins),
        })
    }

    pub(crate) fn handle_mock_command(&mut self) -> Result<CommandExecuteResult, RuntimeError> {
        if let Some(mut server) = self.mock_server.take() {
            server.stop();
            return Ok(CommandExecuteResult {
                handled: true,
                title: "Mock".to_string(),
                message: "Mock API server stopped.".to_string(),
            });
        }

        let server = MockServerHandle::start(MOCK_SERVER_PORT)?;
        let endpoint = server.endpoint();
        self.mock_server = Some(server);
        Ok(CommandExecuteResult {
            handled: true,
            title: "Mock".to_string(),
            message: format!(
                "Mock API server started.\n\nEndpoint: {endpoint}\n\nPoint your SDK at this URL during development. Run /mock again to stop."
            ),
        })
    }

    pub fn quick_mode_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(QuickModeResult {
            enabled: self.quick_mode_enabled()?,
        }))
    }

    pub fn quick_mode_set(
        &mut self,
        params: QuickModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value("quick_mode", if params.enabled { "true" } else { "false" })?;
        self.quick_mode_get()
    }

    pub fn autonomous_mode_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(QuickModeResult {
            enabled: self.autonomous_enabled()?,
        }))
    }

    pub fn autonomous_mode_set(
        &mut self,
        params: RunModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value(
            "autonomous_mode",
            if params.enabled { "true" } else { "false" },
        )?;
        self.autonomous_mode_get()
    }

    pub fn computer_use_mode_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(QuickModeResult {
            enabled: self.computer_use_enabled()?,
        }))
    }

    pub fn computer_use_mode_set(
        &mut self,
        params: RunModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value(
            "computer_use_mode",
            if params.enabled { "true" } else { "false" },
        )?;
        self.computer_use_mode_get()
    }
}
