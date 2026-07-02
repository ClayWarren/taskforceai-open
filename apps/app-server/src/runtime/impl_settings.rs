use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::mcp_util::*;
use super::models::is_ollama_model_id;
use super::orchestration::*;
use super::platform::normalize_plugin_id;
use super::settings_util::*;
use super::util::*;
use super::HYBRID_ROLE;

impl super::AppRuntime {
    pub fn pet_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(PetResult {
            pet: self.pet_state()?,
        }))
    }

    pub fn pet_set(&mut self, params: PetSetParams) -> Result<AppResponse, RuntimeError> {
        let mut pet = self.pet_state()?;
        if let Some(name) = params.name {
            pet.name = normalize_pet_name(&name)?;
        }
        if let Some(mood) = params.mood {
            pet.mood = normalize_pet_mood(&mood)?;
        }
        if let Some(visible) = params.visible {
            pet.visible = visible;
        }
        pet.message = pet_message(&pet);
        self.save_pet_state(&pet)?;
        Ok(value(PetResult { pet }))
    }

    pub fn orchestration_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(OrchestrationConfigResult {
            orchestration: self.orchestration_config()?,
        }))
    }

    pub fn orchestration_set_role(
        &mut self,
        params: OrchestrationRoleSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        let role = normalize_orchestration_role(&params.role)?;
        let model_id = params.model_id.trim();
        if model_id.is_empty() {
            return Err(RuntimeError::invalid_params("modelId is required"));
        }
        let mut config = self.orchestration_config()?;
        for item in &mut config.roles {
            if item.name == role {
                item.model_id = Some(model_id.to_string());
            }
        }
        self.save_orchestration_config(&config)?;
        Ok(value(OrchestrationConfigResult {
            orchestration: config,
        }))
    }

    pub fn orchestration_set_budget(
        &mut self,
        params: OrchestrationBudgetSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        if !params.budget.is_finite() || params.budget < 0.0 {
            return Err(RuntimeError::invalid_params(
                "budget must be zero or greater",
            ));
        }
        let mut config = self.orchestration_config()?;
        config.budget = if params.budget == 0.0 {
            None
        } else {
            Some(params.budget)
        };
        self.save_orchestration_config(&config)?;
        Ok(value(OrchestrationConfigResult {
            orchestration: config,
        }))
    }

    pub fn orchestration_clear(&mut self) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value("orchestration_config", "")?;
        Ok(value(OrchestrationConfigResult {
            orchestration: default_orchestration_config(),
        }))
    }

    pub fn hybrid_mode_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.hybrid_mode_result()?))
    }

    pub fn hybrid_mode_set(
        &mut self,
        params: HybridModeSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        let role = normalize_orchestration_role(params.role.as_deref().unwrap_or(HYBRID_ROLE))?;
        let mut config = self.orchestration_config()?;
        if params.enabled {
            let model_id = params
                .model_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(recommended_ollama_model_id);
            if !is_ollama_model_id(&model_id) {
                return Err(RuntimeError::invalid_params(
                    "hybrid mode requires an ollama/... local model",
                ));
            }
            set_orchestration_role_model(&mut config, &role, Some(model_id));
        } else {
            clear_ollama_orchestration_roles(&mut config);
        }
        self.save_orchestration_config(&config)?;
        Ok(value(self.hybrid_mode_result_for_config(config)?))
    }

    pub fn local_settings_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(LocalSettingsResult {
            settings: self.local_settings()?,
        }))
    }

    pub fn local_settings_update(
        &mut self,
        params: LocalSettingsUpdateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut settings = self.local_settings()?;
        if let Some(theme) = params.theme {
            settings.theme = normalize_theme(&theme)?;
        }
        if let Some(enabled) = params.telemetry_enabled {
            settings.telemetry_enabled = enabled;
        }
        if let Some(dsn) = params.telemetry_dsn {
            settings.telemetry_dsn = dsn.trim().to_string();
        }
        if let Some(environment) = params.telemetry_environment {
            let environment = environment.trim();
            settings.telemetry_environment = if environment.is_empty() {
                "cli".to_string()
            } else {
                environment.to_string()
            };
        }
        if let Some(level) = params.logging_level {
            settings.logging_level = normalize_logging_level(&level)?;
        }
        if let Some(format) = params.logging_format {
            settings.logging_format = normalize_logging_format(&format)?;
        }
        if let Some(enabled) = params.memory_enabled {
            settings.memory_enabled = enabled;
        }
        if let Some(enabled) = params.web_search_enabled {
            settings.web_search_enabled = enabled;
        }
        if let Some(enabled) = params.code_execution_enabled {
            settings.code_execution_enabled = enabled;
        }
        if let Some(enabled) = params.trust_layer_enabled {
            settings.trust_layer_enabled = enabled;
        }
        if let Some(enabled) = params.notifications_enabled {
            settings.notifications_enabled = enabled;
        }
        self.save_local_settings(&settings)?;
        Ok(value(LocalSettingsResult { settings }))
    }

    pub async fn remote_settings_command(
        &mut self,
        params: RemoteSettingsCommandParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for product settings"))?;
        let area = params.area.to_ascii_lowercase();
        let result = match area.as_str() {
            "account" => self.remote_settings_account(&token).await,
            "notifications" => self.remote_settings_notifications(&token, &params.args).await,
            "personalization" => self
                .remote_settings_personalization(&token, &params.args)
                .await,
            "subscription" => self.remote_settings_subscription(&token, &params.args).await,
            "data" => self.remote_settings_data(&token, &params.args).await,
            "apps" => self.remote_settings_apps(&token, &params.args).await,
            _ => Ok(CommandExecuteResult {
                handled: false,
                title: "Settings".to_string(),
                message: "Usage: /settings [account|notifications|personalization|subscription|data|apps]".to_string(),
            }),
        }?;
        Ok(value(result))
    }

    pub fn skill_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.discover_skills()?))
    }

    pub fn plugin_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.discover_plugins()?))
    }

    pub fn plugin_set_enabled(
        &mut self,
        params: PluginSetEnabledParams,
    ) -> Result<AppResponse, RuntimeError> {
        let plugin_id = normalize_plugin_id(&params.plugin_id)?;
        let mut overrides = self.plugin_enabled_overrides()?;
        overrides.insert(plugin_id, params.enabled);
        self.save_plugin_enabled_overrides(&overrides)?;
        Ok(value(self.discover_plugins()?))
    }

    pub fn mcp_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(McpServerListResult {
            servers: self.mcp_servers()?,
        }))
    }

    pub fn mcp_add(&mut self, params: McpServerAddParams) -> Result<AppResponse, RuntimeError> {
        let server = normalize_mcp_server(params)?;
        let mut servers = self.mcp_servers()?;
        match servers
            .iter_mut()
            .find(|existing| existing.name == server.name)
        {
            Some(existing) => *existing = server.clone(),
            None => servers.push(server.clone()),
        }
        servers.sort_by(|left, right| left.name.cmp(&right.name));
        self.set_mcp_servers(&servers)?;
        Ok(value(McpServerResult { server }))
    }

    pub fn mcp_remove(&mut self, params: McpServerParams) -> Result<AppResponse, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let mut servers = self.mcp_servers()?;
        let original_len = servers.len();
        servers.retain(|server| server.name != name);
        if servers.len() == original_len {
            return Err(RuntimeError::not_found("mcp server not found"));
        }
        self.set_mcp_servers(&servers)?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn mcp_enable(&mut self, params: McpServerParams) -> Result<AppResponse, RuntimeError> {
        self.set_mcp_enabled(params, true)
    }

    pub fn mcp_disable(&mut self, params: McpServerParams) -> Result<AppResponse, RuntimeError> {
        self.set_mcp_enabled(params, false)
    }

    pub fn mcp_tools(&mut self, params: McpServerToolsParams) -> Result<AppResponse, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let tools = normalize_mcp_tools(params.tools);
        let mut servers = self.mcp_servers()?;
        let server = servers
            .iter_mut()
            .find(|server| server.name == name)
            .ok_or_else(|| RuntimeError::not_found("mcp server not found"))?;
        server.tools = tools;
        let server = server.clone();
        self.set_mcp_servers(&servers)?;
        Ok(value(McpServerResult { server }))
    }

    pub fn mcp_available(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.mcp_available_result()?))
    }

    pub async fn mcp_inspect(&self, params: McpServerParams) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.mcp_inspect_result(params).await?))
    }

    pub async fn mcp_call_tool(
        &self,
        params: McpToolCallParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.mcp_call_tool_result(params).await?))
    }

    pub(crate) fn mcp_available_result(&self) -> Result<McpAvailableResult, RuntimeError> {
        let servers = self
            .mcp_servers()?
            .into_iter()
            .filter(|server| server.enabled)
            .collect::<Vec<_>>();
        Ok(McpAvailableResult {
            servers,
            adapter_ready: self.config.live_mcp_adapter,
            message: if self.config.live_mcp_adapter {
                "MCP streamable HTTP and stdio adapters are available; SSE endpoints remain config-only."
                    .to_string()
            } else {
                "MCP adapter is configured for inventory; live discovery is disabled.".to_string()
            },
        })
    }

    pub(crate) async fn mcp_inspect_result(
        &self,
        params: McpServerParams,
    ) -> Result<McpInspectResult, RuntimeError> {
        let mut result = self.mcp_inspect_config_result(params)?;
        if self.config.live_mcp_adapter
            && matches!(result.transport.as_str(), "streamable_http" | "stdio")
        {
            let snapshot = if result.transport == "streamable_http" {
                // coverage:ignore-start
                self.mcp_manager
                    .discover_http(&result.server.endpoint)
                    .await
                    .map_err(|err| RuntimeError::network(err.to_string()))?
            // coverage:ignore-end
            } else {
                self.mcp_manager
                    .discover_stdio(result.command.as_deref().unwrap_or_default(), &result.args)
                    .await
                    .map_err(|err| RuntimeError::network(err.to_string()))? // coverage:ignore-line
            }; // coverage:ignore-line
               // coverage:ignore-start
            result.adapter_ready = true;
            result.message = format!(
                // coverage:ignore-end
                "Connected to {} with {} tools, {} prompts, and {} resources.", // coverage:ignore-line
                snapshot.server_name,
                // coverage:ignore-start
                snapshot.tools.len(),
                snapshot.prompts.len(),
                snapshot.resources.len() // coverage:ignore-end
            );
        }
        Ok(result)
    }

    pub(crate) fn mcp_inspect_config_result(
        &self,
        params: McpServerParams,
    ) -> Result<McpInspectResult, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let server = self
            .mcp_servers()?
            .into_iter()
            .find(|server| server.name == name)
            .ok_or_else(|| RuntimeError::not_found("mcp server not found"))?;
        let endpoint = parse_mcp_endpoint(&server.endpoint)?;
        Ok(McpInspectResult {
            server,
            transport: endpoint.kind.clone(),
            command: endpoint.command,
            args: endpoint.args,
            adapter_ready: false,
            message: "MCP inspect is available for streamable HTTP endpoints when the live adapter is enabled.".to_string(),
        })
    }

    pub(crate) async fn mcp_call_tool_result(
        &self,
        params: McpToolCallParams,
    ) -> Result<McpToolCallResult, RuntimeError> {
        self.mcp_call_tool_config_result(params)
    }

    pub(crate) fn mcp_call_tool_config_result(
        &self,
        params: McpToolCallParams,
    ) -> Result<McpToolCallResult, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let tool = normalize_mcp_name(&params.tool)?;
        let server = self
            .mcp_servers()?
            .into_iter()
            .find(|server| server.name == name)
            .ok_or_else(|| RuntimeError::not_found("mcp server not found"))?;
        if !server.enabled {
            return Err(RuntimeError::invalid_params("mcp server is disabled"));
        }
        if !server.tools.is_empty() && !server.tools.iter().any(|allowed| allowed == &tool) {
            return Err(RuntimeError::invalid_params(
                "mcp tool is not enabled for server",
            ));
        }
        Ok(McpToolCallResult {
            server_name: server.name,
            tool_name: tool,
            adapter_ready: false,
            result: None,
            message: "MCP tool execution requires explicit user approval.".to_string(),
        })
    }
}
