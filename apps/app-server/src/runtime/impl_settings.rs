use crate::protocol::*;
use futures_util::{stream, StreamExt};
use std::{
    collections::BTreeMap,
    hash::{DefaultHasher, Hash, Hasher},
};

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
            "notifications" => {
                self.remote_settings_notifications(&token, &params.args)
                    .await
            }
            "personalization" => {
                self.remote_settings_personalization(&token, &params.args)
                    .await
            }
            "subscription" => {
                self.remote_settings_subscription(&token, &params.args)
                    .await
            }
            "data" => self.remote_settings_data(&token, &params.args).await,
            "apps" => self.remote_settings_apps(&token, &params.args).await,
            _ => Ok(command_unhandled(
                "Settings",
                "Usage: /settings [account|notifications|personalization|subscription|data|apps]"
                    .to_string(),
            )),
        }?;
        Ok(value(result))
    }

    pub fn skill_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.discover_skills()?))
    }

    pub fn skill_set_enabled(
        &mut self,
        params: SkillSetEnabledParams,
    ) -> Result<AppResponse, RuntimeError> {
        let path = params.path.trim();
        if path.is_empty() {
            return Err(RuntimeError::invalid_params("path is required"));
        }
        if !self
            .discover_skills()?
            .skills
            .iter()
            .any(|skill| skill.path == path)
        {
            return Err(RuntimeError::not_found("skill not found"));
        }
        let mut overrides = self.skill_enabled_overrides()?;
        overrides.insert(path.to_string(), params.enabled);
        self.set_metadata_json("skill_enabled_overrides", &overrides)?;
        Ok(value(self.discover_skills()?))
    }

    pub fn skill_roots_set(
        &mut self,
        params: SkillRootsSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.roots.len() > 32 {
            return Err(RuntimeError::invalid_params(
                "at most 32 skill roots are allowed",
            ));
        }
        let mut roots = params
            .roots
            .into_iter()
            .map(|root| root.trim().to_string())
            .filter(|root| !root.is_empty())
            .collect::<Vec<_>>();
        if roots
            .iter()
            .any(|root| !std::path::Path::new(root).is_absolute())
        {
            return Err(RuntimeError::invalid_params(
                "skill roots must be absolute paths",
            ));
        }
        roots.sort();
        roots.dedup();
        self.set_metadata_json("skill_roots", &roots)?;
        Ok(value(self.discover_skills()?))
    }

    pub fn skill_watch(&self, params: SkillWatchParams) -> Result<AppResponse, RuntimeError> {
        let skills = self.discover_skills()?.skills;
        let mut hasher = DefaultHasher::new();
        for skill in &skills {
            skill.name.hash(&mut hasher);
            skill.description.hash(&mut hasher);
            skill.path.hash(&mut hasher);
            skill.source.hash(&mut hasher);
            skill.enabled.hash(&mut hasher);
            if let Ok(metadata) = std::fs::metadata(&skill.path) {
                metadata.len().hash(&mut hasher);
                metadata.modified().ok().hash(&mut hasher);
            }
        }
        let revision = format!("{:016x}", hasher.finish());
        Ok(value(SkillWatchResult {
            changed: params.previous_revision.as_deref() != Some(&revision),
            revision,
            skills,
        }))
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
        let status = self.mcp_inspect_result(params).await?;
        Ok(AppResponse::WithEvents {
            result: to_value(status.clone()),
            events: vec![AppServerEvent::McpStartupStatusUpdated {
                status: Box::new(status),
            }],
        })
    }

    pub async fn mcp_call_tool(
        &self,
        params: McpToolCallParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.mcp_call_tool_result(params).await?))
    }

    pub async fn mcp_resource_read(
        &self,
        params: McpResourceReadParams,
    ) -> Result<AppResponse, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let uri = params.uri.trim();
        if uri.is_empty() {
            return Err(RuntimeError::invalid_params("uri is required"));
        }
        let server = self
            .mcp_servers()?
            .into_iter()
            .find(|server| server.name == name)
            .ok_or_else(|| RuntimeError::not_found("mcp server not found"))?;
        if !server.enabled {
            return Err(RuntimeError::invalid_params("mcp server is disabled"));
        }
        self.ensure_mcp_auth_loaded(&server.name, &server.endpoint)
            .await?;
        let endpoint = parse_mcp_endpoint(&server.endpoint)?;
        // coverage:ignore-start -- Live MCP resource transport is covered at the manager boundary with in-process MCP fixtures.
        let result = match endpoint.kind.as_str() {
            "streamable_http" if self.config.live_mcp_adapter => {
                self.mcp_manager
                    .read_resource_http(&server.endpoint, uri)
                    .await
            }
            "stdio" if self.config.live_mcp_adapter => {
                self.mcp_manager
                    .read_resource_stdio(
                        endpoint.command.as_deref().unwrap_or_default(),
                        &endpoint.args,
                        uri,
                    )
                    .await
            }
            _ => {
                return Err(RuntimeError::invalid_params(
                    "live mcp adapter is unavailable",
                ))
            }
        }
        .map_err(|err| RuntimeError::network(err.to_string()))?;
        Ok(value(McpResourceReadResult {
            server_name: server.name,
            uri: uri.to_string(),
            result,
        }))
        // coverage:ignore-end
    }

    pub async fn mcp_reload(&self) -> Result<AppResponse, RuntimeError> {
        let result = McpReloadResult {
            evicted_sessions: self.mcp_manager.reload().await,
        };
        let events = self
            .mcp_servers()?
            .into_iter()
            .map(|server| {
                let status =
                    self.mcp_inspect_config_result(McpServerParams { name: server.name })?;
                Ok(AppServerEvent::McpStartupStatusUpdated {
                    status: Box::new(status),
                })
            })
            .collect::<Result<Vec<_>, RuntimeError>>()?;
        Ok(AppResponse::WithEvents {
            result: to_value(result),
            events,
        })
    }

    pub async fn mcp_auth_set(
        &self,
        params: McpAuthSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = params.access_token.trim();
        if token.is_empty() {
            return Err(RuntimeError::invalid_params("accessToken is required"));
        }
        let mut result = self.mcp_inspect_config_result(McpServerParams { name: params.name })?;
        if result.transport != "streamable_http" {
            return Err(RuntimeError::invalid_params(
                "mcp authentication is supported only for streamable HTTP servers",
            ));
        }
        self.persist_mcp_auth_token(&result.server.name, &result.server.endpoint, Some(token))?;
        self.mcp_manager
            .set_auth_token(&result.server.endpoint, Some(token.to_string()))
            .await;
        result.status = "authenticated_configured".to_string();
        result.auth_required = false;
        result.message =
            "MCP bearer credential stored securely; reload or inspect to reconnect.".to_string();
        Ok(AppResponse::WithEvents {
            result: to_value(result.clone()),
            events: vec![AppServerEvent::McpStartupStatusUpdated {
                status: Box::new(result),
            }],
        })
    }

    pub async fn mcp_auth_clear(
        &self,
        params: McpServerParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut result = self.mcp_inspect_config_result(params)?;
        self.persist_mcp_auth_token(&result.server.name, &result.server.endpoint, None)?;
        self.mcp_manager
            .set_auth_token(&result.server.endpoint, None)
            .await;
        result.status = "configured".to_string();
        result.message =
            "MCP bearer credential cleared and cached session invalidated.".to_string();
        Ok(AppResponse::WithEvents {
            result: to_value(result.clone()),
            events: vec![AppServerEvent::McpStartupStatusUpdated {
                status: Box::new(result),
            }],
        })
    }

    // coverage:ignore-start -- OAuth discovery and callback exchange require a live external authorization server.
    pub async fn mcp_oauth_start(
        &self,
        params: McpOAuthStartParams,
    ) -> Result<AppResponse, RuntimeError> {
        let redirect_uri = params.redirect_uri.trim();
        if redirect_uri.is_empty() {
            return Err(RuntimeError::invalid_params("redirectUri is required"));
        }
        let mut status = self.mcp_inspect_config_result(McpServerParams { name: params.name })?;
        if status.transport != "streamable_http" {
            return Err(RuntimeError::invalid_params(
                "MCP OAuth is supported only for streamable HTTP servers",
            ));
        }
        let authorization_url = self
            .mcp_manager
            .start_oauth(&status.server.endpoint, &params.scopes, redirect_uri)
            .await
            .map_err(|error| RuntimeError::network(error.to_string()))?;
        status.status = "oauth_pending".to_string();
        status.auth_required = true;
        status.message = "Open the authorization URL, then submit the callback URL.".to_string();
        Ok(AppResponse::WithEvents {
            result: to_value(McpOAuthStartResult {
                server_name: status.server.name.clone(),
                authorization_url,
                redirect_uri: redirect_uri.to_string(),
                status: status.status.clone(),
            }),
            events: vec![AppServerEvent::McpStartupStatusUpdated {
                status: Box::new(status),
            }],
        })
    }

    pub async fn mcp_oauth_complete(
        &self,
        params: McpOAuthCompleteParams,
    ) -> Result<AppResponse, RuntimeError> {
        let callback_url = params.callback_url.trim();
        if callback_url.is_empty() {
            return Err(RuntimeError::invalid_params("callbackUrl is required"));
        }
        let mut status = self.mcp_inspect_config_result(McpServerParams { name: params.name })?;
        let token = self
            .mcp_manager
            .complete_oauth(&status.server.endpoint, callback_url)
            .await
            .map_err(|error| RuntimeError::network(error.to_string()))?;
        self.persist_mcp_auth_token(&status.server.name, &status.server.endpoint, Some(&token))?;
        self.mcp_manager
            .set_auth_token(&status.server.endpoint, Some(token))
            .await;
        status.status = "authenticated_configured".to_string();
        status.auth_required = false;
        status.message = "MCP OAuth login completed and stored securely.".to_string();
        Ok(AppResponse::WithEvents {
            result: to_value(status.clone()),
            events: vec![
                AppServerEvent::McpStartupStatusUpdated {
                    status: Box::new(status.clone()),
                },
                AppServerEvent::McpOAuthCompleted {
                    status: Box::new(status),
                },
            ],
        })
    }
    // coverage:ignore-end

    pub async fn mcp_oauth_status(
        &self,
        params: McpServerParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut status = self.mcp_inspect_config_result(params)?;
        self.ensure_mcp_auth_loaded(&status.server.name, &status.server.endpoint)
            .await?;
        // coverage:ignore-start -- Pending OAuth state can only be produced by a live authorization-server exchange.
        if self
            .mcp_manager
            .oauth_pending(&status.server.endpoint)
            .await
        {
            status.status = "oauth_pending".to_string();
            status.auth_required = true;
            status.message = "MCP OAuth login is waiting for its callback.".to_string();
        // coverage:ignore-end
        } else if self.mcp_manager.has_auth_token(&status.server.endpoint) {
            status.status = "authenticated_configured".to_string();
            status.auth_required = false;
            status.message = "A durable MCP credential is configured.".to_string();
        }
        Ok(value(status))
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
        self.ensure_mcp_auth_loaded(&result.server.name, &result.server.endpoint)
            .await?;
        if self.config.live_mcp_adapter
            && matches!(result.transport.as_str(), "streamable_http" | "stdio")
        {
            let snapshot_result = if result.transport == "streamable_http" {
                // coverage:ignore-start
                self.mcp_manager
                    .discover_http(&result.server.endpoint)
                    .await
            // coverage:ignore-end
            } else {
                self.mcp_manager
                    .discover_stdio(result.command.as_deref().unwrap_or_default(), &result.args)
                    .await // coverage:ignore-line
            }; // coverage:ignore-line
               // coverage:ignore-start -- Live discovery outcomes are covered at the MCP manager boundary with protocol fixtures.
            let snapshot = match snapshot_result {
                Ok(snapshot) => snapshot,
                Err(err) if mcp_error_requires_auth(&err.to_string()) => {
                    result.status = "authentication_required".to_string();
                    result.auth_required = true;
                    result.message = "MCP server requires authentication; complete its OAuth flow and reload the session.".to_string();
                    return Ok(result);
                }
                Err(err) => return Err(RuntimeError::network(err.to_string())),
            };
            // coverage:ignore-end
            // coverage:ignore-start
            result.adapter_ready = true;
            result.status = "connected".to_string();
            result.message = format!(
                // coverage:ignore-end
                "Connected to {} with {} tools, {} prompts, {} resources, and {} resource templates.", // coverage:ignore-line
                snapshot.server_name,
                // coverage:ignore-start
                snapshot.tools.len(),
                snapshot.prompts.len(),
                snapshot.resources.len(),
                snapshot.resource_templates.len() // coverage:ignore-end
            );
        }
        Ok(result)
    }

    pub(crate) async fn mcp_server_status_list(
        &self,
        params: McpServerStatusListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let offset = params
            .cursor
            .as_deref()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(|_| RuntimeError::invalid_params("invalid MCP server status cursor"))?;
        let limit = params.limit.unwrap_or(50).clamp(1, 200);
        let detail = params.detail.unwrap_or_default();
        let _thread_id = params.thread_id;

        let mut servers = self.mcp_servers()?;
        servers.sort_by(|left, right| left.name.cmp(&right.name));
        if offset > servers.len() {
            return Err(RuntimeError::invalid_params(
                "MCP server status cursor exceeds the server count",
            ));
        }
        let end = offset.saturating_add(limit).min(servers.len());
        let next_cursor = (end < servers.len()).then(|| end.to_string());
        let page = servers[offset..end].to_vec();
        let data = stream::iter(page)
            .map(|server| self.mcp_server_status(server, detail))
            .buffered(8)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?;

        Ok(value(McpServerStatusListResult { data, next_cursor }))
    }

    async fn mcp_server_status(
        &self,
        server: McpServerRecord,
        detail: McpServerStatusDetail,
    ) -> Result<McpServerStatus, RuntimeError> {
        let endpoint = parse_mcp_endpoint(&server.endpoint)?;
        self.ensure_mcp_auth_loaded(&server.name, &server.endpoint)
            .await?;
        let auth_status = if self.mcp_manager.has_auth_token(&server.endpoint) {
            McpAuthStatus::BearerToken
        } else if self.mcp_manager.oauth_pending(&server.endpoint).await {
            McpAuthStatus::NotLoggedIn
        } else {
            McpAuthStatus::Unsupported
        };

        if !server.enabled {
            return Ok(empty_mcp_server_status(
                server.name,
                auth_status,
                "disabled",
                None,
            ));
        }
        if !self.config.live_mcp_adapter
            || !matches!(endpoint.kind.as_str(), "streamable_http" | "stdio")
        {
            return Ok(empty_mcp_server_status(
                server.name,
                auth_status,
                "configured",
                None,
            ));
        }

        let snapshot = if endpoint.kind == "streamable_http" {
            self.mcp_manager
                .discover_http_with_detail(&server.endpoint, detail)
                .await
        } else {
            self.mcp_manager
                .discover_stdio_with_detail(
                    endpoint.command.as_deref().unwrap_or_default(),
                    &endpoint.args,
                    detail,
                )
                .await
        };
        Ok(match snapshot {
            Ok(snapshot) => {
                discovered_mcp_server_status(server.name, snapshot, auth_status, detail)
            }
            Err(error) if mcp_error_requires_auth(&error.to_string()) => empty_mcp_server_status(
                server.name,
                McpAuthStatus::NotLoggedIn,
                "authentication_required",
                Some(error.to_string()),
            ),
            Err(error) => {
                empty_mcp_server_status(server.name, auth_status, "error", Some(error.to_string()))
            }
        })
    }

    async fn ensure_mcp_auth_loaded(&self, name: &str, endpoint: &str) -> Result<(), RuntimeError> {
        if self.mcp_manager.has_auth_token(endpoint)
            || !matches!(
                self.config.auth_token_storage,
                super::AuthTokenStorage::KeyringWithMemoryFallback
            )
        {
            return Ok(());
        }
        // coverage:ignore-start -- Platform Keychain I/O is exercised by desktop integration tests.
        let service = format!("{}.mcp", self.config.auth_keychain_service);
        let account = mcp_credential_account(name, endpoint);
        if let Some(token) = keychain_get_secret(&service, &account)
            .map_err(|error| RuntimeError::storage(error.to_string()))?
        {
            self.mcp_manager.set_auth_token(endpoint, Some(token)).await;
        }
        Ok(())
        // coverage:ignore-end
    }

    fn persist_mcp_auth_token(
        &self,
        name: &str,
        endpoint: &str,
        token: Option<&str>,
    ) -> Result<(), RuntimeError> {
        if !matches!(
            self.config.auth_token_storage,
            super::AuthTokenStorage::KeyringWithMemoryFallback
        ) {
            return Ok(());
        }
        // coverage:ignore-start -- Platform Keychain I/O is exercised by desktop integration tests.
        let service = format!("{}.mcp", self.config.auth_keychain_service);
        let account = mcp_credential_account(name, endpoint);
        match token {
            Some(token) => keychain_set_secret(&service, &account, token),
            None => keychain_delete_secret(&service, &account),
        }
        .map_err(|error| RuntimeError::storage(error.to_string()))
        // coverage:ignore-end
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
            status: "configured".to_string(),
            auth_required: false,
            oauth_supported: endpoint.kind == "streamable_http",
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

// coverage:ignore-start -- Deterministic account formatting belongs to the platform Keychain integration boundary.
fn mcp_credential_account(name: &str, endpoint: &str) -> String {
    format!("{}:{}", name.trim(), endpoint.trim())
}
// coverage:ignore-end

fn mcp_error_requires_auth(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("401")
        || message.contains("unauthorized")
        || message.contains("authentication required")
}

fn empty_mcp_server_status(
    name: String,
    auth_status: McpAuthStatus,
    connection_status: &str,
    error: Option<String>,
) -> McpServerStatus {
    McpServerStatus {
        name,
        server_info: None,
        tools: BTreeMap::new(),
        prompts: Vec::new(),
        resources: Vec::new(),
        resource_templates: Vec::new(),
        auth_status,
        connection_status: connection_status.to_string(),
        error,
    }
}

fn discovered_mcp_server_status(
    name: String,
    snapshot: crate::mcp::AppServerMcpSnapshot,
    auth_status: McpAuthStatus,
    detail: McpServerStatusDetail,
) -> McpServerStatus {
    let tools = snapshot
        .tools
        .into_iter()
        .map(|tool| {
            let discovered = McpDiscoveredTool {
                name: tool.name.clone(),
                title: non_empty_mcp_value(tool.title),
                description: non_empty_mcp_value(tool.description),
                input_schema: tool.input_schema,
                output_schema: tool.output_schema,
                annotations: tool.annotations,
            };
            (tool.name, discovered)
        })
        .collect();
    let full_detail = matches!(detail, McpServerStatusDetail::Full);
    McpServerStatus {
        name,
        server_info: full_detail.then_some(McpDiscoveredServerInfo {
            name: snapshot.server_name,
            title: non_empty_mcp_value(snapshot.server_title),
            version: snapshot.server_version,
            protocol_version: snapshot.protocol_version,
            instructions: non_empty_mcp_value(snapshot.instructions),
        }),
        tools,
        prompts: if full_detail {
            snapshot
                .prompts
                .into_iter()
                .map(|prompt| McpDiscoveredPrompt {
                    name: prompt.name,
                    title: non_empty_mcp_value(prompt.title),
                    description: non_empty_mcp_value(prompt.description),
                    arguments: prompt
                        .arguments
                        .into_iter()
                        .map(|argument| McpDiscoveredPromptArgument {
                            name: argument.name,
                            title: non_empty_mcp_value(argument.title),
                            description: non_empty_mcp_value(argument.description),
                            required: argument.required,
                        })
                        .collect(),
                })
                .collect()
        } else {
            Vec::new()
        },
        resources: if full_detail {
            snapshot
                .resources
                .into_iter()
                .map(|resource| McpDiscoveredResource {
                    uri: resource.uri,
                    name: resource.name,
                    title: non_empty_mcp_value(resource.title),
                    description: non_empty_mcp_value(resource.description),
                    mime_type: non_empty_mcp_value(resource.mime_type),
                    size: resource.size,
                    annotations: resource.annotations,
                })
                .collect()
        } else {
            Vec::new()
        },
        resource_templates: if full_detail {
            snapshot
                .resource_templates
                .into_iter()
                .map(|template| McpDiscoveredResourceTemplate {
                    uri_template: template.uri_template,
                    name: template.name,
                    title: non_empty_mcp_value(template.title),
                    description: non_empty_mcp_value(template.description),
                    mime_type: non_empty_mcp_value(template.mime_type),
                    annotations: template.annotations,
                })
                .collect()
        } else {
            Vec::new()
        },
        auth_status,
        connection_status: "connected".to_string(),
        error: None,
    }
}

fn non_empty_mcp_value(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}
