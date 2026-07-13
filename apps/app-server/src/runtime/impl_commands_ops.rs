use serde_json::json;

use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::settings_util::*;
use super::util::*;

impl super::AppRuntime {
    pub(crate) fn handle_logging_settings(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            let settings = self.local_settings()?;
            return Ok(command_message(
                "Settings",
                format!(
                    "Logging level: {}\nLogging format: {}",
                    settings.logging_level, settings.logging_format
                ),
            ));
        }
        let update = match args[0].to_ascii_lowercase().as_str() {
            "level" => LocalSettingsUpdateParams {
                logging_level: args.get(1).map(|value| (*value).to_string()),
                ..Default::default()
            },
            "format" => LocalSettingsUpdateParams {
                logging_format: args.get(1).map(|value| (*value).to_string()),
                ..Default::default()
            },
            _ => {
                return Ok(command_unhandled(
                    "Settings",
                    "Usage: /settings logging <level|format> ...",
                ))
            }
        };
        self.local_settings_update(update)?;
        Ok(command_message("Settings", "Logging settings updated."))
    }

    pub(crate) async fn remote_settings_account(
        &self,
        token: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let user = self.api_client.current_user(token).await?;
        Ok(command_message("Settings", format_account_settings(&user)))
    }

    pub(crate) async fn remote_settings_notifications(
        &self,
        token: &str,
        args: &[String],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            let user = self.api_client.current_user(token).await?;
            return Ok(command_message(
                "Settings",
                format!(
                    "Notifications: {}\nUse /settings notifications <on|off>.",
                    on_off(value_bool(&user, "notifications_enabled"))
                ),
            ));
        }
        let enabled = parse_on_off(&args[0]).ok_or_else(|| {
            RuntimeError::invalid_params("usage: /settings notifications <on|off>")
        })?;
        let message = self
            .api_client
            .update_settings(token, json!({ "notifications_enabled": enabled }))
            .await?;
        Ok(command_message("Settings", message))
    }

    pub(crate) async fn remote_settings_personalization(
        &self,
        token: &str,
        args: &[String],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args.is_empty() {
            let user = self.api_client.current_user(token).await?;
            return Ok(command_message(
                "Settings",
                format_personalization_settings(&user),
            ));
        }
        if args.len() < 2 {
            return Err(RuntimeError::invalid_params(
                "usage: /settings personalization <memory|web-search|code-execution|trust-layer|direct-chat> <on|off>",
            ));
        }
        let key = personalization_api_key(&args[0]).ok_or_else(|| {
            RuntimeError::invalid_params(
                "usage: /settings personalization <memory|web-search|code-execution|trust-layer|direct-chat> <on|off>",
            )
        })?;
        let enabled = parse_on_off(&args[1]).ok_or_else(|| {
            RuntimeError::invalid_params(
                "usage: /settings personalization <memory|web-search|code-execution|trust-layer|direct-chat> <on|off>",
            )
        })?;
        let message = self
            .api_client
            .update_settings(token, json!({ key: enabled }))
            .await?;
        Ok(command_message("Settings", message))
    }

    pub(crate) async fn remote_settings_subscription(
        &self,
        token: &str,
        args: &[String],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "status");
        let message = match action.as_str() {
            "status" => {
                let user = self.api_client.current_user(token).await?;
                let subscription = self.api_client.subscription(token).await?;
                format_subscription_settings(&user, &subscription)
            }
            "cancel" => self.api_client.cancel_subscription(token).await?,
            "reactivate" => self.api_client.reactivate_subscription(token).await?,
            "upgrade" => {
                let plan = args.get(1).ok_or_else(|| {
                    RuntimeError::invalid_params(
                        "usage: /settings subscription upgrade <free|pro|team>",
                    )
                })?;
                validate_plan(plan)?;
                self.api_client.upgrade_plan(token, plan).await?
            }
            _ => {
                return Err(RuntimeError::invalid_params(
                    "usage: /settings subscription <status|cancel|reactivate|upgrade <plan>>",
                ));
            }
        };
        Ok(command_message("Settings", message))
    }

    pub(crate) async fn remote_settings_data(
        &mut self,
        token: &str,
        args: &[String],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = args.first().map(|value| value.to_ascii_lowercase());
        match action.as_deref() {
            None => Ok(command_message(
                "Settings",
                "Use /settings data export or /settings data delete <email>.",
            )),
            Some("export") => {
                // coverage:ignore-start
                let raw = self.api_client.export_gdpr_data(token).await?;
                let target = data_export_path()?;
                std::fs::write(&target, raw)?;
                Ok(command_message(
                    "Settings",
                    format!("Exported account data to {}", target.display()),
                ))
                // coverage:ignore-end
            }
            Some("delete") => {
                let email = args.get(1).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /settings data delete <email>")
                })?;
                let user = self.api_client.current_user(token).await?;
                if !value_string(&user, "email").eq_ignore_ascii_case(email) {
                    return Err(RuntimeError::invalid_params(
                        "confirmation email does not match the authenticated account",
                    ));
                }
                let message = self.api_client.delete_account(token, email).await?;
                self.set_auth_token(None)?;
                Ok(command_message("Settings", message))
            }
            _ => Err(RuntimeError::invalid_params(
                "usage: /settings data <export|delete <email>>",
            )),
        }
    }

    pub(crate) async fn remote_settings_apps(
        &self,
        token: &str,
        args: &[String],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        match action.as_str() {
            "list" => {
                let integrations = self.api_client.integrations(token).await?;
                Ok(command_message(
                    "Settings",
                    format_integrations(&integrations),
                ))
            }
            "connect" => {
                let provider = args.get(1).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /settings apps connect <provider>")
                })?;
                Ok(command_message(
                    "Settings",
                    format!("Open https://www.taskforceai.chat/api/auth/signin/{provider} to connect {provider}."),
                ))
            }
            "disconnect" => {
                let provider = args.get(1).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /settings apps disconnect <provider>")
                })?;
                let message = self
                    .api_client
                    .disconnect_integration(token, provider)
                    .await?;
                Ok(command_message("Settings", message))
            }
            _ => Err(RuntimeError::invalid_params(
                "usage: /settings apps <list|connect <provider>|disconnect <provider>>",
            )),
        }
    }

    pub(crate) fn handle_goal_command(
        &mut self,
        raw_args: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let args = raw_args.trim();
        if args.is_empty() {
            return Ok(command_message(
                "Goal",
                format_goal_state(self.goal_record()?),
            ));
        }

        match args.to_ascii_lowercase().as_str() {
            "pause" => {
                let goal = self.update_goal_status(GoalStatus::Paused)?;
                Ok(command_result(
                    goal.is_some(),
                    "Goal",
                    goal.map(|goal| format!("Goal paused: {}", goal.objective))
                        .unwrap_or_else(|| "No active goal to pause.".to_string()),
                ))
            }
            "resume" => {
                let goal = self.update_goal_status(GoalStatus::Active)?;
                Ok(command_result(
                    goal.is_some(),
                    "Goal",
                    goal.map(|goal| format!("Goal resumed: {}", goal.objective))
                        .unwrap_or_else(|| "No paused goal to resume.".to_string()),
                ))
            }
            "clear" => {
                self.clear_goal()?;
                Ok(command_message("Goal", "Goal cleared."))
            }
            _ => {
                let goal = self.set_goal(args)?;
                Ok(command_message(
                    "Goal",
                    format!("Goal set: {}", goal.objective),
                ))
            }
        }
    }

    pub(crate) fn handle_agents_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        let message = match action.as_str() {
            "list" | "status" | "" => format_agent_sessions(self.agent_sessions()?),
            "create" | "start" => {
                let objective = args.get(1..).unwrap_or_default().join(" ");
                let result: AgentSessionResult =
                    from_value_response(self.agent_session_create(AgentSessionCreateParams {
                        objective,
                        title: None,
                        source: Some("slash".to_string()),
                        task_mode: Default::default(),
                    })?)?;
                format!(
                    "Created {}: {}",
                    result.session.session_id, result.session.objective
                )
            }
            "pause" => {
                let id = required_arg(args, 1, "usage: /agents pause <session-id>")?;
                let result: AgentSessionResult =
                    from_value_response(self.agent_session_pause(AgentSessionIDParams {
                        session_id: id.to_string(),
                    })?)?;
                format!("Paused {}", result.session.session_id)
            }
            "resume" => {
                let id = required_arg(args, 1, "usage: /agents resume <session-id>")?;
                let result: AgentSessionResult =
                    from_value_response(self.agent_session_resume(AgentSessionIDParams {
                        session_id: id.to_string(),
                    })?)?;
                format!("Resumed {}", result.session.session_id)
            }
            "cancel" | "stop" => {
                let id = required_arg(args, 1, "usage: /agents cancel <session-id>")?;
                let result: AgentSessionResult =
                    from_value_response(self.agent_session_cancel(AgentSessionIDParams {
                        session_id: id.to_string(),
                    })?)?;
                format!("Cancelled {}", result.session.session_id)
            }
            "message" | "send" => {
                let id = required_arg(args, 1, "usage: /agents message <session-id> <message>")?;
                let message = args.get(2..).unwrap_or_default().join(" ");
                let result: AgentSessionResult = from_value_response(self.agent_session_message(
                    AgentSessionMessageParams {
                        session_id: id.to_string(),
                        message, // coverage:ignore-line
                    },
                )?)?; // coverage:ignore-line
                format!("Steering queued for {}", result.session.session_id)
            }
            "fork" => {
                let id = required_arg(args, 1, "usage: /agents fork <session-id>")?;
                let result: AgentSessionResult =
                    from_value_response(self.agent_session_fork(AgentSessionIDParams {
                        session_id: id.to_string(),
                    })?)?;
                format!("Forked {}", result.session.session_id)
            }
            _ => "Usage: /agents [list|create <objective>|pause|resume|cancel|message|fork]"
                .to_string(),
        };
        Ok(command_message("Agents", message))
    }

    pub(crate) fn handle_channel_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        let message = match action.as_str() {
            "list" | "" => format_channels(self.channels()?),
            "add" => {
                let name = required_arg(args, 1, "usage: /channel add <name> [session-id]")?;
                let target_session_id = args.get(2).map(|value| value.to_string());
                let result: ChannelResult =
                    from_value_response(self.channel_add(ChannelAddParams {
                        name: name.to_string(),
                        kind: "local".to_string(),
                        target_session_id,
                        enabled: true,
                    })?)?;
                format!(
                    "Added {} ({})",
                    result.channel.name, result.channel.channel_id
                )
            }
            "delete" | "remove" => {
                let id = required_arg(args, 1, "usage: /channel delete <channel-id>")?;
                let _ = self.channel_delete(ChannelIDParams {
                    channel_id: id.to_string(),
                })?;
                format!("Deleted {id}")
            }
            "push" => {
                let id = required_arg(args, 1, "usage: /channel push <channel-id> <message>")?;
                let message = args.get(2..).unwrap_or_default().join(" ");
                let result: ChannelResult =
                    from_value_response(self.channel_push_local(ChannelPushParams {
                        channel_id: id.to_string(),
                        message,
                        dispatch: false,
                    })?)?;
                format!("Pushed event to {}", result.channel.name)
            }
            _ => "Usage: /channel [list|add <name> [session-id]|push <id> <message>|delete <id>]"
                .to_string(),
        };
        Ok(command_message("Channels", message))
    }

    pub(crate) fn handle_schedule_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        let message = match action.as_str() {
            "list" | "" => format_schedules(self.schedules()?),
            "add" => {
                let name = required_arg(args, 1, "usage: /schedule add <name> <cadence> <prompt>")?;
                let cadence =
                    required_arg(args, 2, "usage: /schedule add <name> <cadence> <prompt>")?;
                let prompt = args.get(3..).unwrap_or_default().join(" ");
                let result: ScheduleResult =
                    from_value_response(self.schedule_add(ScheduleAddParams {
                        name: name.to_string(),
                        prompt,
                        cadence: cadence.to_string(),
                        target_session_id: None,
                        enabled: true,
                    })?)?;
                format!(
                    "Added {} ({})",
                    result.schedule.name, result.schedule.schedule_id
                )
            }
            "enable" => {
                let id = required_arg(args, 1, "usage: /schedule enable <schedule-id>")?;
                let result: ScheduleResult =
                    from_value_response(self.schedule_enable(ScheduleIDParams {
                        schedule_id: id.to_string(),
                    })?)?;
                format!("Enabled {}", result.schedule.schedule_id)
            }
            "disable" => {
                let id = required_arg(args, 1, "usage: /schedule disable <schedule-id>")?;
                let result: ScheduleResult =
                    from_value_response(self.schedule_disable(ScheduleIDParams {
                        schedule_id: id.to_string(),
                    })?)?;
                format!("Disabled {}", result.schedule.schedule_id)
            }
            "delete" | "remove" => {
                let id = required_arg(args, 1, "usage: /schedule delete <schedule-id>")?;
                let _ = self.schedule_delete(ScheduleIDParams {
                    schedule_id: id.to_string(),
                })?;
                format!("Deleted {id}")
            }
            _ => "Usage: /schedule [list|add <name> <cadence> <prompt>|enable|disable|delete]"
                .to_string(),
        };
        Ok(command_message("Schedules", message))
    }

    pub(crate) async fn handle_workflow_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        let message = match action.as_str() {
            "list" | "" => format_workflows(self.workflows()?),
            "runs" | "status" => format_workflow_runs(self.workflow_runs()?),
            "run" => {
                let id = required_arg(args, 1, "usage: /workflows run <workflow-id>")?;
                let result: WorkflowRunResult = from_response_result(
                    self.workflow_run(WorkflowRunParams {
                        workflow_id: id.to_string(),
                        args: serde_json::Value::Null,
                    }) // coverage:ignore-line
                    .await?,
                )?; // coverage:ignore-line
                format!("Queued {}", result.run.run_id)
            }
            "pause" => {
                let id = required_arg(args, 1, "usage: /workflows pause <run-id>")?;
                let result: WorkflowRunResult =
                    from_response_result(self.workflow_run_pause(WorkflowRunIDParams {
                        run_id: id.to_string(),
                    })?)?;
                format!("Paused {}", result.run.run_id)
            }
            "resume" => {
                let id = required_arg(args, 1, "usage: /workflows resume <run-id>")?;
                let result: WorkflowRunResult =
                    from_response_result(self.workflow_run_resume(WorkflowRunIDParams {
                        run_id: id.to_string(),
                    })?)?;
                format!("Resumed {}", result.run.run_id)
            }
            "cancel" => {
                let id = required_arg(args, 1, "usage: /workflows cancel <run-id>")?;
                let result: WorkflowRunResult =
                    from_response_result(self.workflow_run_cancel(WorkflowRunIDParams {
                        run_id: id.to_string(),
                    })?)?;
                format!("Cancelled {}", result.run.run_id)
            }
            _ => "Usage: /workflows [list|runs|run <workflow-id>|pause|resume|cancel <run-id>]"
                .to_string(),
        };
        Ok(command_message("Workflows", message))
    }

    pub(crate) fn handle_pet_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "status");
        let result = match action.as_str() {
            "status" | "" => PetResult {
                pet: self.pet_state()?,
            },
            "show" | "on" => from_value_response(self.pet_set(PetSetParams {
                name: None,
                mood: None,
                visible: Some(true),
            })?)?,
            "hide" | "off" => from_value_response(self.pet_set(PetSetParams {
                name: None,
                mood: None,
                visible: Some(false),
            })?)?,
            "name" => from_value_response(self.pet_set(PetSetParams {
                name: Some(args.get(1..).unwrap_or_default().join(" ")),
                mood: None,
                visible: None,
            })?)?,
            "mood" => from_value_response(self.pet_set(PetSetParams {
                name: None,
                mood: Some(args.get(1).copied().unwrap_or_default().to_string()),
                visible: None,
            })?)?,
            _ => {
                return Ok(command_message(
                    "Companion",
                    "Usage: /pet [status|show|hide|name <name>|mood <focus|idle|celebrate|alert>]"
                        .to_string(),
                ));
            }
        };
        Ok(command_message("Companion", format_pet_state(&result.pet)))
    }

    pub(crate) async fn handle_project_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "status");
        match action.as_str() {
            "use" | "select" | "set" => {
                let project_id = parse_project_id(args.get(1).copied())?;
                self.project_use(ProjectIDParams { project_id })?;
                Ok(command_message(
                    "Project",
                    format!("Active project set to {project_id}."),
                ))
            }
            "clear" | "none" | "unset" => {
                self.project_clear()?;
                Ok(command_message("Project", "Active project cleared."))
            }
            "status" | "list" | "ls" => {
                let result: ProjectListResult = from_value_response(self.project_list().await?)?;
                let active = result
                    .active_project_id
                    .map(|project_id| project_id.to_string())
                    .unwrap_or_else(|| "none".to_string());
                let mut lines = vec![format!("active: {active}")];
                if result.projects.is_empty() {
                    lines.push("No remote projects available.".to_string());
                } else {
                    lines.extend(result.projects.into_iter().map(|project| {
                        let marker = if Some(project.id) == result.active_project_id {
                            "*" // coverage:ignore-line
                        } else {
                            "-" // coverage:ignore-line
                        };
                        format!("{marker} {}: {}", project.id, project.name)
                    }));
                }
                Ok(command_message("Project", lines.join("\n")))
            }
            "create" | "new" | "add" => {
                let name = args.get(1..).unwrap_or_default().join(" ");
                if name.trim().is_empty() {
                    return Ok(command_unhandled(
                        "Project",
                        "Usage: /project create <name>",
                    ));
                }
                let result: ProjectResult = from_value_response(
                    self.project_create(ProjectCreateParams {
                        name: name.trim().to_string(),
                        description: None,
                        custom_instructions: None,
                        workspace_roots: Vec::new(),
                    }) // coverage:ignore-line
                    .await?,
                )?; // coverage:ignore-line
                Ok(command_message(
                    "Project",
                    format!(
                        "Created project {}: {}",
                        result.project.id, result.project.name
                    ),
                ))
            }
            "delete" | "remove" | "rm" => {
                let project_id = parse_project_id(args.get(1).copied())?;
                self.project_delete(ProjectIDParams { project_id }).await?;
                Ok(command_message(
                    "Project",
                    format!("Deleted project {project_id}."),
                ))
            }
            _ => Ok(command_unhandled(
                "Project",
                "Usage: /project [status|use <id>|clear]",
            )),
        }
    }

    pub(crate) async fn handle_mcp_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = normalized_action(args, "list");
        match action.as_str() {
            "list" | "ls" => Ok(command_message(
                "MCP",
                format_mcp_servers(&self.mcp_servers()?),
            )),
            "add" => {
                // coverage:ignore-line
                let name = args.get(1).ok_or_else(|| {
                    // coverage:ignore-line
                    // coverage:ignore-start
                    RuntimeError::invalid_params("usage: /mcp add <name> <endpoint>")
                })?;
                // coverage:ignore-end
                let endpoint = args.get(2).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /mcp add <name> <endpoint>")
                })?;
                let (tools, enabled) = parse_mcp_options(&args[3..]);
                let server = self.mcp_add(McpServerAddParams {
                    name: (*name).to_string(),
                    endpoint: (*endpoint).to_string(),
                    tools, // coverage:ignore-line
                    enabled,
                })?;
                let AppResponse::Value(result) = server else {
                    unreachable!("mcp_add returns a value response"); // coverage:ignore-line
                };
                Ok(command_message(
                    "MCP",
                    format!("Configured MCP server {}.", result["server"]["name"]),
                ))
            }
            "remove" | "rm" => {
                let name = args
                    .get(1)
                    .ok_or_else(|| RuntimeError::invalid_params("usage: /mcp remove <name>"))?;
                self.mcp_remove(McpServerParams {
                    name: (*name).to_string(),
                })?;
                Ok(command_message(
                    "MCP",
                    format!("Removed MCP server {name}."),
                ))
            }
            "enable" => {
                let name = args
                    .get(1)
                    .ok_or_else(|| RuntimeError::invalid_params("usage: /mcp enable <name>"))?;
                self.mcp_enable(McpServerParams {
                    name: (*name).to_string(),
                })?;
                Ok(command_message(
                    "MCP",
                    format!("Enabled MCP server {name}."),
                ))
            }
            "disable" => {
                let name = args
                    .get(1)
                    .ok_or_else(|| RuntimeError::invalid_params("usage: /mcp disable <name>"))?;
                self.mcp_disable(McpServerParams {
                    name: (*name).to_string(),
                })?;
                Ok(command_message(
                    "MCP",
                    format!("Disabled MCP server {name}."),
                ))
            }
            "available" => Ok(command_message(
                "MCP",
                format_mcp_available(&self.mcp_available_result()?), // coverage:ignore-line
            )), // coverage:ignore-line
            "tools" => {
                let name = args.get(1).ok_or_else(|| {
                    // coverage:ignore-start
                    RuntimeError::invalid_params("usage: /mcp tools <name> <tool1,tool2,...>")
                })?;
                // coverage:ignore-end
                let tools = args.get(2).ok_or_else(|| {
                    RuntimeError::invalid_params("usage: /mcp tools <name> <tool1,tool2,...>")
                })?;
                let result: McpServerResult =
                    from_value_response(self.mcp_tools(McpServerToolsParams {
                        name: (*name).to_string(),
                        tools: split_tools(tools),
                    })?)?;
                Ok(command_message(
                    "MCP",
                    format!("Updated tools for MCP server {}.", result.server.name),
                ))
            }
            "inspect" => {
                let name = args
                    .get(1)
                    .ok_or_else(|| RuntimeError::invalid_params("usage: /mcp inspect <name>"))?;
                Ok(command_message(
                    "MCP", // coverage:ignore-line
                    format_mcp_inspect(&from_value_response(
                        self.mcp_inspect(McpServerParams {
                            name: (*name).to_string(),
                        })
                        .await?, // coverage:ignore-line
                    )?), // coverage:ignore-line
                ))
            }
            "call" => {
                let name = args.get(1).ok_or_else(|| {
                    // coverage:ignore-start
                    RuntimeError::invalid_params("usage: /mcp call <name> <tool>")
                })?;
                // coverage:ignore-end
                let tool = args.get(2).ok_or_else(|| {
                    // coverage:ignore-line
                    RuntimeError::invalid_params("usage: /mcp call <name> <tool>")
                    // coverage:ignore-line
                })?; // coverage:ignore-line
                Ok(command_message(
                    // coverage:ignore-line
                    // coverage:ignore-start
                    "MCP".to_string(),
                    format_mcp_call_result(&from_value_response(
                        self.mcp_call_tool(McpToolCallParams {
                            name: (*name).to_string(),
                            tool: (*tool).to_string(),
                            input: parse_json_arg(args.get(3).copied())?,
                            // coverage:ignore-end
                        })
                        // coverage:ignore-start
                        .await?,
                    )?),
                    // coverage:ignore-end
                ))
            }
            _ => Ok(command_unhandled(
                "MCP",
                "Usage: /mcp [list|available|inspect|call|add|remove|tools|enable|disable]"
                    .to_string(),
            )),
        }
    }
}

fn normalized_action<T: AsRef<str>>(args: &[T], default: &str) -> String {
    args.first()
        .map(|value| value.as_ref().to_ascii_lowercase())
        .unwrap_or_else(|| default.to_string())
}

fn parse_mcp_options(args: &[&str]) -> (Vec<String>, bool) {
    let mut tools = Vec::new();
    let mut enabled = true;
    for arg in args {
        if let Some(value) = arg.strip_prefix("tools=") {
            tools = split_tools(value);
        } else if let Some(value) = arg.strip_prefix("enabled=") {
            enabled = !value.eq_ignore_ascii_case("false");
        }
    }
    (tools, enabled)
}

fn split_tools(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|tool| !tool.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}
