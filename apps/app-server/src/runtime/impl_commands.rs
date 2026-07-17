use crate::protocol::*;
use std::path::{Path, PathBuf};

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
            "help" => command_message("Help", command_help_message()),
            "status" => command_message(
                "Status",
                format_status_summary(&self.status_summary_result()?),
            ),
            "usage" => command_message("Usage", format_usage_summary(&self.usage_summary_result())),
            "account" => self.handle_account_usage_command().await?,
            "artifact" | "artifacts" => self.handle_artifacts_command(&args).await?,
            "search" => command_message(
                "Search",
                search_message(
                    self.runs
                        .values()
                        .filter(|run| !self.private_run_ids.contains(&run.id)),
                    &args.join(" "),
                ),
            ),
            "goal" => self.handle_goal_command(input.strip_prefix("/goal").unwrap_or_default())?,
            "agents" | "agent" => self.handle_agents_command(&args)?,
            "inspect" | "doctor" => command_message(
                "Inspect",
                format_diagnostics(self.diagnostics_inspect_result()?),
            ),
            "channel" | "channels" => self.handle_channel_command(&args)?,
            "schedule" | "schedules" => self.handle_schedule_command(&args)?,
            "workflow" | "workflows" => self.handle_workflow_command(&args).await?,
            "pet" | "companion" => self.handle_pet_command(&args)?,
            "skills" | "skill" => {
                command_message("Skills", format_skills(self.discover_skills()?.skills))
            }
            "plugins" | "plugin" => self.handle_plugin_command(&args)?,
            "computer" | "computer-use" => {
                command_message("Computer Use", self.computer_use_status_message())
            }
            "browser" | "in-app-browser" => {
                command_message("Browser", self.browser_status_message())
            }
            "mcp" => self.handle_mcp_command(&args).await?,
            "pending" | "queue" => self.handle_pending_command(&args).await?,
            "prompt-queue" => self.handle_prompt_queue_command(&args).await?,
            "pending-changes" => self.handle_pending_changes_command(&args)?,
            "attach" | "attachment" | "attachments" => {
                self.handle_attachment_command(&args).await?
            }
            "project" | "projects" => self.handle_project_command(&args).await?,
            "context" => command_message(
                "Context",
                format_context_summary(self.context_summary_result()),
            ),
            "memory" => command_message(
                "Memory",
                format_memory_summary(self.memory_summary_result()),
            ),
            "direct" | "quick" => self.handle_quick_command(&args)?,
            "model" => self.handle_model_command(&args)?,
            "settings" => self.handle_settings_command(&args).await?,
            "config" => self.handle_config_command(&args).await?,
            "logout" => {
                self.set_auth_token(None)?;
                command_message("Logout", "Cached auth token cleared.")
            }
            "orchestrate" | "orchestration" => self.handle_orchestration_command(&args)?,
            "sync" => self.handle_sync_command(&args).await?,
            "clear" => command_message("Clear", "Cleared the current client view."),
            "new" => command_message("New", "Started a new client prompt."),
            "reset-local" | "reset" => {
                self.metadata_clear_all()?;
                command_message(
                    "Local Storage",
                    "Cleared local conversations, messages, pending queues, and metadata."
                        .to_string(),
                )
            }
            "mock" => self.handle_mock_command()?,
            "login" | "upgrade" => command_unhandled(
                command.to_string(),
                format!("/{command} is reserved for a desktop/app-server adapter"),
            ),
            "exit" | "quit" => command_message("Exit", "Use Esc or Ctrl-C to quit the Rust TUI."),
            "" => command_unhandled("Command", "Type /help for commands."),
            _ => command_unhandled(
                "Unknown command",
                format!("Unknown command /{command}. Type /help for commands."),
            ),
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
        match action.as_str() {
            "list" | "ls" | "status" | "browse" => Ok(command_message(
                "Plugins",
                format_plugins(self.discover_plugins()?.plugins),
            )),
            "enable" | "on" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                if plugin_id.trim().is_empty() {
                    return Ok(command_unhandled(
                        "Plugins",
                        "Usage: /plugins enable <plugin-id>",
                    ));
                }
                let result: PluginListResult =
                    from_value_response(self.plugin_set_enabled(PluginSetEnabledParams {
                        plugin_id: plugin_id.trim().to_string(),
                        enabled: true,
                    })?)?;
                Ok(command_message("Plugins", format_plugins(result.plugins)))
            }
            "disable" | "off" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                if plugin_id.trim().is_empty() {
                    return Ok(command_unhandled(
                        "Plugins",
                        "Usage: /plugins disable <plugin-id>".to_string(), // coverage:ignore-line
                    ));
                }
                let result: PluginListResult =
                    from_value_response(self.plugin_set_enabled(PluginSetEnabledParams {
                        plugin_id: plugin_id.trim().to_string(),
                        enabled: false,
                    })?)?;
                Ok(command_message("Plugins", format_plugins(result.plugins)))
            }
            "install" | "add" => {
                let requested = args.get(1..).unwrap_or_default().join(" ");
                if requested.trim().is_empty() {
                    return Ok(command_unhandled(
                        "Plugins",
                        "Usage: /plugins install <path|git-url|github:owner/repo|plugin-id>",
                    ));
                }
                let source = self.resolve_plugin_install_source(requested.trim())?;
                let installed = super::plugin_manager::install_plugin(&source)?;
                Ok(command_message(
                    "Plugins",
                    format!(
                        "Installed {} ({}).\n\n{}",
                        installed.name,
                        installed.id,
                        format_plugins(self.discover_plugins()?.plugins)
                    ),
                ))
            }
            "update" | "upgrade" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                let plugin = self.find_plugin(plugin_id.trim())?;
                let updated = super::plugin_manager::update_plugin(Path::new(&plugin.path))?;
                Ok(command_message(
                    "Plugins",
                    format!("Updated {} ({}).", updated.name, updated.id),
                ))
            }
            "uninstall" | "remove" | "rm" => {
                let plugin_id = args.get(1..).unwrap_or_default().join(" ");
                let plugin = self.find_plugin(plugin_id.trim())?;
                let removed = super::plugin_manager::uninstall_plugin(Path::new(&plugin.path))?;
                let mut overrides = self.plugin_enabled_overrides()?;
                overrides.remove(&removed.id);
                self.save_plugin_enabled_overrides(&overrides)?;
                Ok(command_message(
                    "Plugins",
                    format!("Uninstalled {} ({}).", removed.name, removed.id),
                ))
            }
            _ => Ok(command_unhandled(
                "Plugins",
                "Usage: /plugins [browse|install <source>|update <plugin-id>|uninstall <plugin-id>|enable <plugin-id>|disable <plugin-id>]",
            )),
        }
    }

    fn find_plugin(&self, value: &str) -> Result<PluginRecord, RuntimeError> {
        let value = value.trim();
        if value.is_empty() {
            return Err(RuntimeError::invalid_params("plugin id is required"));
        }
        self.discover_plugins()?
            .plugins
            .into_iter()
            .find(|plugin| {
                plugin.id.eq_ignore_ascii_case(value) || plugin.name.eq_ignore_ascii_case(value)
            })
            .ok_or_else(|| RuntimeError::not_found(format!("plugin not found: {value}")))
    }

    fn resolve_plugin_install_source(&self, requested: &str) -> Result<String, RuntimeError> {
        if Path::new(requested).exists()
            || requested.starts_with("https://")
            || requested.starts_with("http://")
            || requested.starts_with("ssh://")
            || requested.starts_with("git@")
            || requested.starts_with("github:")
        {
            return Ok(requested.to_string());
        }
        let plugin = self.find_plugin(requested)?;
        let manifest = PathBuf::from(plugin.path);
        let parent = manifest
            .parent()
            .ok_or_else(|| RuntimeError::not_found("plugin manifest has no package directory"))?;
        let root = if parent.file_name().and_then(|name| name.to_str()) == Some(".codex-plugin") {
            parent.parent().unwrap_or(parent)
        } else {
            parent
        };
        Ok(root.to_string_lossy().to_string())
    }
    // coverage:ignore-line
    // coverage:ignore-start
    pub(crate) fn handle_mock_command(&mut self) -> Result<CommandExecuteResult, RuntimeError> {
        if let Some(mut server) = self.mock_server.take() {
            server.stop();
            return Ok(command_message("Mock", "Mock API server stopped."));
        }
        // coverage:ignore-end
        // coverage:ignore-line
        // coverage:ignore-start
        let server = MockServerHandle::start(MOCK_SERVER_PORT)?;
        let endpoint = server.endpoint();
        self.mock_server = Some(server);
        Ok(command_message(
            "Mock",
            format!(
                "Mock API server started.\n\nEndpoint: {endpoint}\n\nPoint your SDK at this URL during development. Run /mock again to stop."
            ),
        ))
    }
    // coverage:ignore-end

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
    // coverage:ignore-line
    pub fn autonomous_mode_set(
        &mut self,
        params: RunModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value(
            "autonomous_mode",
            if params.enabled { "true" } else { "false" },
        )?; // coverage:ignore-line
        self.autonomous_mode_get()
    }

    pub fn computer_use_mode_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(QuickModeResult {
            enabled: self.computer_use_enabled()?,
        }))
    }
    // coverage:ignore-line
    pub fn computer_use_mode_set(
        &mut self,
        params: RunModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value(
            "computer_use_mode",
            if params.enabled { "true" } else { "false" },
        )?; // coverage:ignore-line
        self.computer_use_mode_get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{AppRuntime, RuntimeConfig};

    #[tokio::test]
    async fn command_execute_covers_dispatcher_local_settings_and_reserved_edges() {
        let mut runtime = AppRuntime::new(RuntimeConfig::default());

        let error = runtime
            .command_execute(CommandExecuteParams {
                input: "help".to_string(),
            })
            .await
            .expect_err("non-slash command should fail");
        assert!(error.to_string().contains("command must start with /"));

        for (input, expected_title, expected_handled) in [
            ("/", "Command", false),
            ("/wat", "Unknown command", false),
            ("/login", "login", false),
            ("/upgrade", "upgrade", false),
            ("/exit", "Exit", true),
            ("/usage", "Usage", true),
            ("/inspect", "Inspect", true),
            ("/doctor", "Inspect", true),
            ("/clear", "Clear", true),
            ("/new", "New", true),
            ("/logout", "Logout", true),
            ("/context", "Context", true),
            ("/memory", "Memory", true),
            ("/computer", "Computer Use", true),
            ("/browser", "Browser", true),
            ("/skills", "Skills", true),
            ("/plugins", "Plugins", true),
            ("/plugins browse", "Plugins", true),
            ("/plugins install", "Plugins", false),
            ("/plugins enable", "Plugins", false),
            ("/plugins disable", "Plugins", false),
            ("/plugins nope", "Plugins", false),
            ("/settings", "Settings", true),
            ("/settings account", "Settings", false),
            ("/settings nope", "Settings", false),
            ("/config", "Config", true),
            ("/settings theme", "Settings", true),
            ("/settings theme dark", "Settings", true),
            ("/settings telemetry", "Settings", true),
            ("/settings telemetry on", "Settings", true),
            (
                "/settings telemetry dsn https://example.invalid/1",
                "Settings",
                true,
            ),
            ("/settings telemetry env test", "Settings", true),
            ("/settings telemetry nope", "Settings", false),
            ("/settings logging", "Settings", true),
            ("/settings logging level debug", "Settings", true),
            ("/settings logging format json", "Settings", true),
            ("/settings logging nope", "Settings", false),
            ("/settings model", "Model", true),
            ("/settings mcp", "MCP", true),
            ("/config theme system", "Settings", true),
            ("/reset-local", "Local Storage", true),
            ("/reset", "Local Storage", true),
            ("/direct", "Direct Chat", true),
            ("/quick on", "Direct Chat", true),
            ("/model", "Model", true),
            ("/model set sentinel", "Model", true),
        ] {
            let result = command(&mut runtime, input).await;
            assert_eq!(
                result.title, expected_title,
                "unexpected title for {input}: {result:?}"
            );
            assert_eq!(
                result.handled, expected_handled,
                "unexpected handled flag for {input}: {result:?}"
            );
        }
    }

    async fn command(runtime: &mut AppRuntime, input: &str) -> CommandExecuteResult {
        let response = runtime
            .command_execute(CommandExecuteParams {
                input: input.to_string(),
            })
            .await
            .unwrap_or_else(|err| panic!("{input} should not error: {err}"));
        let AppResponse::Value(value) = response else {
            panic!("{input} should return a value response");
        };
        serde_json::from_value(value)
            .unwrap_or_else(|err| panic!("{input} returned invalid command result: {err}"))
    }
}
