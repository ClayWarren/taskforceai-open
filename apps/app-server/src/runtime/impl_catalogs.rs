use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::protocol::*;

use super::error::RuntimeError;
use super::util::{unix_millis, value};

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        value => value.clone(),
    }
}

fn canonical_approval_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "approvalId"
                            | "approval_id"
                            | "createdAt"
                            | "created_at"
                            | "runId"
                            | "run_id"
                            | "taskId"
                            | "task_id"
                    )
                })
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        value => canonical_json(value),
    }
}

fn grant_key(thread_id: &str, signature: &str) -> String {
    format!("{thread_id}\u{0}{signature}")
}

fn integration_label(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalized_integration_id(id: &str) -> Result<&str, RuntimeError> {
    let id = id.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(RuntimeError::invalid_params(
            "integrationId must contain only letters, numbers, hyphens, or underscores",
        ));
    }
    Ok(id)
}

fn integration_values(value: &Value) -> &[Value] {
    value
        .as_array()
        .or_else(|| value.get("providers").and_then(Value::as_array))
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn integration_record(value: &Value) -> Option<IntegrationAppRecord> {
    let id = value
        .get("provider")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)?
        .trim();
    if id.is_empty() {
        return None;
    }
    Some(IntegrationAppRecord {
        id: id.to_string(),
        label: value
            .get("label")
            .or_else(|| value.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| integration_label(id)),
        connected: value
            .get("connected")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        description: value
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        authorization_url: Some(format!("https://www.taskforceai.chat/api/auth/signin/{id}")),
    })
}

impl super::AppRuntime {
    pub(crate) fn approval_signature(permissions: &Value) -> String {
        canonical_approval_json(permissions).to_string()
    }

    pub(crate) fn has_permission_grant(&self, thread_id: &str, signature: &str) -> bool {
        self.approval_grants
            .lock()
            .expect("approval grant lock should not be poisoned")
            .contains_key(&grant_key(thread_id, signature))
    }

    pub(crate) fn save_permission_grant(
        grants: &std::sync::Mutex<BTreeMap<String, PermissionGrantRecord>>,
        thread_id: String,
        signature: String,
        permissions: Value,
    ) {
        grants
            .lock()
            .expect("approval grant lock should not be poisoned")
            .insert(
                grant_key(&thread_id, &signature),
                PermissionGrantRecord {
                    thread_id,
                    signature,
                    permissions,
                    created_at: unix_millis(),
                },
            );
    }

    pub(crate) fn clear_thread_permission_grants(&self, thread_id: &str) {
        self.approval_grants
            .lock()
            .expect("approval grant lock should not be poisoned")
            .retain(|_, grant| grant.thread_id != thread_id);
    }

    pub fn permission_profile_list(&self) -> AppResponse {
        value(PermissionProfileListResult {
            profiles: vec![
                PermissionProfileRecord {
                    id: PermissionProfile::ReadOnly,
                    label: "Read only".into(),
                    description: "Inspect files and state without changing them.".into(),
                    filesystem: "read".into(),
                    network: false,
                },
                PermissionProfileRecord {
                    id: PermissionProfile::WorkspaceWrite,
                    label: "Workspace write".into(),
                    description: "Read and edit files inside the active workspace.".into(),
                    filesystem: "workspace_write".into(),
                    network: true,
                },
                PermissionProfileRecord {
                    id: PermissionProfile::FullAccess,
                    label: "Full access".into(),
                    description: "Use the host filesystem and network without workspace limits."
                        .into(),
                    filesystem: "unrestricted".into(),
                    network: true,
                },
            ],
        })
    }

    pub fn permission_grant_list(&self, params: PermissionGrantListParams) -> AppResponse {
        let grants = self
            .approval_grants
            .lock()
            .expect("approval grant lock should not be poisoned")
            .values()
            .filter(|grant| {
                params
                    .thread_id
                    .as_ref()
                    .is_none_or(|id| id == &grant.thread_id)
            })
            .cloned()
            .collect();
        value(PermissionGrantListResult { grants })
    }

    pub fn permission_grant_clear(&self, params: PermissionGrantClearParams) -> AppResponse {
        self.approval_grants
            .lock()
            .expect("approval grant lock should not be poisoned")
            .retain(|_, grant| {
                grant.thread_id != params.thread_id
                    || params
                        .signature
                        .as_ref()
                        .is_some_and(|signature| signature != &grant.signature)
            });
        value(AckResult { ok: true })
    }

    pub fn agent_mode_list(&self) -> AppResponse {
        value(AgentModeListResult {
            modes: vec![
                AgentModeRecord {
                    id: "chat".into(),
                    label: "Chat".into(),
                    description: "Discuss and explore without autonomous execution.".into(),
                    task_mode: TaskMode::Chat,
                    permission_profile: PermissionProfile::ReadOnly,
                    autonomous: false,
                    supports_subagents: false,
                },
                AgentModeRecord {
                    id: "work".into(),
                    label: "Work".into(),
                    description: "Execute a task with workspace-scoped tools.".into(),
                    task_mode: TaskMode::Work,
                    permission_profile: PermissionProfile::WorkspaceWrite,
                    autonomous: true,
                    supports_subagents: true,
                },
                AgentModeRecord {
                    id: "code".into(),
                    label: "Code".into(),
                    description: "Implement and verify code changes in the workspace.".into(),
                    task_mode: TaskMode::Code,
                    permission_profile: PermissionProfile::WorkspaceWrite,
                    autonomous: true,
                    supports_subagents: true,
                },
            ],
        })
    }

    pub async fn model_provider_list(&self) -> Result<AppResponse, RuntimeError> {
        let models = self.model_list_result().await?;
        let mut providers = BTreeMap::<
            String,
            (
                BTreeSet<String>,
                BTreeSet<String>,
                BTreeSet<String>,
                bool,
                bool,
                bool,
                Vec<ModelCapabilityRecord>,
            ),
        >::new();
        for model in &models.options {
            let provider_id = model.id.split('/').next().unwrap_or("unknown").to_string();
            let image_generation = matches!(model.badge.as_str(), "image" | "video");
            let inputs = if image_generation {
                vec!["text".to_string(), "image".to_string()]
            } else {
                vec!["text".to_string()]
            };
            let outputs = vec![if image_generation {
                model.badge.clone()
            } else {
                "text".to_string()
            }];
            let provider = providers.entry(provider_id).or_default();
            provider.0.insert(model.id.clone());
            provider.1.extend(inputs.iter().cloned());
            provider.2.extend(outputs.iter().cloned());
            provider.3 |= !image_generation;
            provider.4 |= !image_generation;
            provider.5 |= image_generation;
            provider.6.push(ModelCapabilityRecord {
                id: model.id.clone(),
                input_modalities: inputs,
                output_modalities: outputs,
                supports_tools: !image_generation,
                supports_web_search: !image_generation,
                supports_image_generation: image_generation,
            });
        }
        let providers = providers
            .into_iter()
            .map(|(id, provider)| ModelProviderRecord {
                label: integration_label(&id),
                id,
                model_ids: provider.0.into_iter().collect(),
                input_modalities: provider.1.into_iter().collect(),
                output_modalities: provider.2.into_iter().collect(),
                supports_tools: provider.3,
                supports_web_search: provider.4,
                supports_image_generation: provider.5,
                models: provider.6,
            })
            .collect();
        Ok(value(ModelProviderListResult { providers }))
    }

    async fn integration_apps(&self) -> Result<Vec<IntegrationAppRecord>, RuntimeError> {
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for integrations"))?;
        let raw = self.api_client.integrations(&token).await?;
        Ok(integration_values(&raw)
            .iter()
            .filter_map(integration_record)
            .collect())
    }

    pub async fn integration_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(IntegrationListResult {
            apps: self.integration_apps().await?,
        }))
    }

    pub async fn integration_get(
        &self,
        params: IntegrationIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let integration_id = normalized_integration_id(&params.integration_id)?;
        let app = self
            .integration_apps()
            .await?
            .into_iter()
            .find(|app| app.id == integration_id)
            .ok_or_else(|| RuntimeError::not_found("integration not found"))?;
        Ok(value(IntegrationResult { app }))
    }

    pub async fn integration_connect(
        &self,
        params: IntegrationIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let integration_id = normalized_integration_id(&params.integration_id)?.to_string();
        let mut app = self
            .integration_apps()
            .await?
            .into_iter()
            .find(|app| app.id == integration_id)
            .unwrap_or_else(|| IntegrationAppRecord {
                label: integration_label(&integration_id),
                id: integration_id.clone(),
                connected: false,
                description: None,
                authorization_url: None,
            });
        app.authorization_url = Some(format!(
            "https://www.taskforceai.chat/api/auth/signin/{}",
            integration_id
        ));
        Ok(value(IntegrationResult { app }))
    }

    pub async fn integration_disconnect(
        &self,
        params: IntegrationIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let integration_id = normalized_integration_id(&params.integration_id)?.to_string();
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for integrations"))?;
        let message = self
            .api_client
            .disconnect_integration(&token, &integration_id)
            .await?;
        Ok(value(IntegrationDisconnectResult {
            integration_id,
            disconnected: true,
            message,
        }))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::runtime::{AppRuntime, RuntimeConfig};

    #[test]
    fn permission_grants_are_thread_scoped_and_ignore_transient_approval_ids() {
        let runtime = AppRuntime::new(RuntimeConfig::default());
        let first =
            json!({"approvalId": "approval-1", "permission": "shell", "command": "cargo test"});
        let second =
            json!({"approvalId": "approval-2", "command": "cargo test", "permission": "shell"});
        let signature = AppRuntime::approval_signature(&first);
        assert_eq!(signature, AppRuntime::approval_signature(&second));

        let nested_first = json!({
            "approvalId": "approval-1",
            "permission": "mcp.call",
            "metadata": {
                "arguments": {"taskId": "target-1", "createdAt": 1},
                "toolName": "delete_task"
            }
        });
        let nested_second = json!({
            "approvalId": "approval-2",
            "metadata": {
                "toolName": "delete_task",
                "arguments": {"createdAt": 1, "taskId": "target-2"}
            },
            "permission": "mcp.call"
        });
        assert_ne!(
            AppRuntime::approval_signature(&nested_first),
            AppRuntime::approval_signature(&nested_second),
            "nested tool arguments must remain part of the remembered approval signature"
        );

        AppRuntime::save_permission_grant(
            &runtime.approval_grants,
            "thread-1".to_string(),
            signature.clone(),
            first,
        );
        assert!(runtime.has_permission_grant("thread-1", &signature));
        assert!(!runtime.has_permission_grant("thread-2", &signature));

        runtime.clear_thread_permission_grants("thread-1");
        assert!(!runtime.has_permission_grant("thread-1", &signature));
    }

    #[test]
    fn catalogs_expose_profiles_and_agent_modes() {
        let runtime = AppRuntime::new(RuntimeConfig::default());
        let AppResponse::Value(profiles) = runtime.permission_profile_list() else {
            panic!("profile catalog must be a value response");
        };
        let AppResponse::Value(modes) = runtime.agent_mode_list() else {
            panic!("mode catalog must be a value response");
        };
        assert_eq!(profiles["profiles"].as_array().map(Vec::len), Some(3));
        assert_eq!(modes["modes"].as_array().map(Vec::len), Some(3));
    }

    #[test]
    fn integration_ids_are_path_safe() {
        assert_eq!(
            normalized_integration_id("github").expect("valid id"),
            "github"
        );
        assert!(normalized_integration_id("../admin").is_err());
        assert!(normalized_integration_id("").is_err());
    }
}
