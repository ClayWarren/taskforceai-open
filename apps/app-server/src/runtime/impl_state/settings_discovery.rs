use std::collections::{BTreeMap, BTreeSet};

use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::format::{
    browser_message, computer_use_message, default_pet_state, normalize_pet_mood,
    normalize_pet_name, pet_message,
};
use crate::runtime::mcp_util::*;
use crate::runtime::models::is_ollama_model_id;
use crate::runtime::orchestration::*;
use crate::runtime::platform::{
    context_suggestions, memory_source_candidates, memory_source_record, memory_suggestions,
    parse_plugin_manifest, parse_skill_file, plugin_enabled_config, plugin_manifest_files,
    skill_markdown_files, skill_roots, skill_source,
};
use crate::runtime::settings_util::*;
use crate::runtime::util::*;

impl crate::runtime::AppRuntime {
    pub(crate) fn pet_state(&self) -> Result<PetState, RuntimeError> {
        let Some(raw) = self.metadata_value("pet_state")? else {
            return Ok(default_pet_state());
        };
        if raw.trim().is_empty() {
            return Ok(default_pet_state());
        }
        let mut pet: PetState =
            serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))?;
        pet.name = normalize_pet_name(&pet.name)?;
        pet.mood = normalize_pet_mood(&pet.mood)?;
        pet.message = pet_message(&pet);
        Ok(pet)
    }

    pub(crate) fn save_pet_state(&mut self, pet: &PetState) -> Result<(), RuntimeError> {
        let serialized =
            serde_json::to_string(pet).map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("pet_state", &serialized)
    }

    pub(crate) fn orchestration_config(&self) -> Result<OrchestrationConfig, RuntimeError> {
        let Some(raw) = self.metadata_value("orchestration_config")? else {
            return Ok(default_orchestration_config());
        };
        if raw.trim().is_empty() {
            return Ok(default_orchestration_config());
        }
        let mut config: OrchestrationConfig =
            serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))?;
        merge_default_orchestration_roles(&mut config);
        Ok(config)
    }

    pub(crate) fn save_orchestration_config(
        &mut self,
        config: &OrchestrationConfig,
    ) -> Result<(), RuntimeError> {
        let serialized =
            serde_json::to_string(config).map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("orchestration_config", &serialized)
    }

    pub(crate) fn hybrid_mode_result(&self) -> Result<HybridModeResult, RuntimeError> {
        self.hybrid_mode_result_for_config(self.orchestration_config()?)
    }

    pub(crate) fn hybrid_mode_result_for_config(
        &self,
        config: OrchestrationConfig,
    ) -> Result<HybridModeResult, RuntimeError> {
        let role = hybrid_role_name(&config);
        let model_id = config
            .roles
            .iter()
            .find(|item| item.name == role)
            .and_then(|item| item.model_id.clone())
            .filter(|model_id| is_ollama_model_id(model_id));
        let recommended_model_id = recommended_ollama_model_id();
        let enabled = model_id.is_some();
        let message = if enabled {
            format!(
                "Hybrid mode enabled: cloud model remains primary; local {} runs as {}. Hosted submissions skip local-only role models until the Rust app-server owns orchestration.",
                model_id.as_deref().unwrap_or(&recommended_model_id),
                role
            )
        } else {
            format!(
                "Hybrid mode disabled. Use /hybrid on to assign {} as a local {} role.",
                recommended_model_id, role
            )
        };
        Ok(HybridModeResult {
            enabled,
            role,
            model_id,
            recommended_model_id,
            message,
            orchestration: config,
        })
    }

    pub(crate) fn local_settings(&self) -> Result<LocalSettings, RuntimeError> {
        let Some(raw) = self.metadata_value("local_settings")? else {
            return Ok(default_local_settings());
        };
        if raw.trim().is_empty() {
            return Ok(default_local_settings());
        }
        let settings: LocalSettings =
            serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))?;
        normalize_local_settings(settings)
    }

    pub(crate) fn save_local_settings(
        &mut self,
        settings: &LocalSettings,
    ) -> Result<(), RuntimeError> {
        let serialized = serde_json::to_string(settings)
            .map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("local_settings", &serialized)
    }

    pub(crate) fn mcp_servers(&self) -> Result<Vec<McpServerRecord>, RuntimeError> {
        let Some(raw) = self.metadata_value("mcp_servers")? else {
            return Ok(Vec::new());
        };
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))
    }

    pub(crate) fn set_mcp_servers(
        &mut self,
        servers: &[McpServerRecord],
    ) -> Result<(), RuntimeError> {
        let serialized =
            serde_json::to_string(servers).map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("mcp_servers", &serialized)
    }

    pub(crate) fn set_mcp_enabled(
        &mut self,
        params: McpServerParams,
        enabled: bool,
    ) -> Result<AppResponse, RuntimeError> {
        let name = normalize_mcp_name(&params.name)?;
        let mut servers = self.mcp_servers()?;
        let server = servers
            .iter_mut()
            .find(|server| server.name == name)
            .ok_or_else(|| RuntimeError::not_found("mcp server not found"))?;
        server.enabled = enabled;
        let server = server.clone();
        self.set_mcp_servers(&servers)?;
        Ok(value(McpServerResult { server }))
    }

    pub(crate) fn discover_skills(&self) -> Result<SkillListResult, RuntimeError> {
        let mut skills = Vec::new();
        let mut seen_paths = BTreeSet::new();
        for root in skill_roots() {
            if !root.exists() {
                continue;
            }
            let source = skill_source(&root);
            for skill_path in skill_markdown_files(&root)? {
                let Ok(path_key) = skill_path.canonicalize() else {
                    continue;
                };
                if !seen_paths.insert(path_key.clone()) {
                    continue;
                }
                if let Some(skill) = parse_skill_file(&skill_path, &source)? {
                    skills.push(skill);
                }
            }
        }
        skills.sort_by(|left, right| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
                .then_with(|| left.path.cmp(&right.path))
        });
        Ok(SkillListResult {
            truncated: false,
            skills,
        })
    }

    pub(crate) fn discover_plugins(&self) -> Result<PluginListResult, RuntimeError> {
        let mut plugins = Vec::new();
        let mut seen_paths = BTreeSet::new();
        let config_enabled = plugin_enabled_config();
        let override_enabled = self.plugin_enabled_overrides()?;
        for manifest_path in plugin_manifest_files()? {
            let Ok(path_key) = manifest_path.canonicalize() else {
                continue;
            };
            if !seen_paths.insert(path_key) {
                continue;
            }
            if let Some(mut plugin) = parse_plugin_manifest(&manifest_path)? {
                if let Some(enabled) = config_enabled.get(&plugin.id) {
                    plugin.enabled = *enabled;
                }
                if let Some(enabled) = override_enabled.get(&plugin.id) {
                    plugin.enabled = *enabled;
                }
                plugins.push(plugin);
            }
        }
        plugins.sort_by(|left, right| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(PluginListResult { plugins })
    }

    pub(crate) fn plugin_enabled_overrides(&self) -> Result<BTreeMap<String, bool>, RuntimeError> {
        let Some(raw) = self.metadata_value("plugin_enabled_overrides")? else {
            return Ok(BTreeMap::new());
        };
        if raw.trim().is_empty() {
            return Ok(BTreeMap::new());
        }
        serde_json::from_str(&raw).map_err(|err| RuntimeError::storage(err.to_string()))
    }

    pub(crate) fn save_plugin_enabled_overrides(
        &mut self,
        overrides: &BTreeMap<String, bool>,
    ) -> Result<(), RuntimeError> {
        let serialized = serde_json::to_string(overrides)
            .map_err(|err| RuntimeError::storage(err.to_string()))?;
        self.set_metadata_value("plugin_enabled_overrides", &serialized)
    }

    pub(crate) fn computer_use_status_result(&self) -> ComputerUseStatusResult {
        let supported = cfg!(target_os = "macos");
        let installed = self
            .discover_plugins()
            .map(|result| {
                result.plugins.iter().any(|plugin| {
                    let id = plugin.id.to_ascii_lowercase();
                    let name = plugin.name.to_ascii_lowercase();
                    id.contains("computer-use") || name.contains("computer use")
                })
            })
            .unwrap_or(false);
        ComputerUseStatusResult {
            supported,
            installed,
            permission_required: supported && !installed,
            locked_use_supported: supported,
            message: computer_use_message(supported, installed),
        }
    }

    pub(crate) fn computer_use_status_message(&self) -> String {
        self.computer_use_status_result().message
    }

    pub(crate) fn browser_status_result(&self) -> BrowserStatusResult {
        let installed = self
            .discover_plugins()
            .map(|result| {
                result.plugins.iter().any(|plugin| {
                    let id = plugin.id.to_ascii_lowercase();
                    let name = plugin.name.to_ascii_lowercase();
                    id.contains("browser") || name.contains("browser")
                })
            })
            .unwrap_or(false);
        BrowserStatusResult {
            supported: true,
            installed,
            supports_auth: false,
            message: browser_message(installed),
        }
    }

    pub(crate) fn browser_status_message(&self) -> String {
        self.browser_status_result().message
    }

    pub(crate) fn context_summary_result(&self) -> ContextSummaryResult {
        let skill_count = self
            .discover_skills()
            .map(|result| result.skills.len())
            .unwrap_or(0);
        let plugin_count = self
            .discover_plugins()
            .map(|result| result.plugins.len())
            .unwrap_or(0);
        let mut items = vec![
            ContextItem {
                category: "startup".to_string(),
                label: "System prompt, repository instructions, environment".to_string(),
                estimated_tokens: 6_000,
            },
            ContextItem {
                category: "skills".to_string(),
                label: format!("{skill_count} discovered skill descriptions"),
                estimated_tokens: skill_count.saturating_mul(80),
            },
            ContextItem {
                category: "plugins".to_string(),
                label: format!("{plugin_count} discovered plugin manifests"),
                estimated_tokens: plugin_count.saturating_mul(60),
            },
            ContextItem {
                category: "history".to_string(),
                label: format!("{} local run records", self.runs.len()),
                estimated_tokens: self.runs.len().saturating_mul(180),
            },
            ContextItem {
                category: "queue".to_string(),
                label: format!("{} pending prompts", self.pending_prompts.len()),
                estimated_tokens: self.pending_prompts.len().saturating_mul(120),
            },
        ];
        if self.goal_record().ok().flatten().is_some() {
            items.push(ContextItem {
                category: "goal".to_string(),
                label: "Active durable goal".to_string(),
                estimated_tokens: 120,
            });
        }
        if self.active_project_id().ok().flatten().is_some() {
            items.push(ContextItem {
                category: "project".to_string(),
                label: "Active project selection".to_string(),
                estimated_tokens: 40,
            });
        }
        let estimated_tokens = items.iter().map(|item| item.estimated_tokens).sum();
        ContextSummaryResult {
            max_tokens: 200_000,
            estimated_tokens,
            items,
            suggestions: context_suggestions(
                self.runs.len(),
                self.pending_prompts.len(),
                skill_count,
            ),
        }
    }

    pub(crate) fn memory_summary_result(&self) -> MemorySummaryResult {
        let sources = memory_source_candidates()
            .into_iter()
            .map(|(scope, path)| memory_source_record(scope, path))
            .collect::<Vec<_>>();
        let estimated_tokens = sources.iter().map(|source| source.estimated_tokens).sum();
        MemorySummaryResult {
            suggestions: memory_suggestions(&sources),
            sources,
            estimated_tokens,
        }
    }
}
