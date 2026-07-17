use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{PermissionProfile, TaskMode};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionProfileRecord {
    pub id: PermissionProfile,
    pub label: String,
    pub description: String,
    pub filesystem: String,
    pub network: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionProfileListResult {
    pub profiles: Vec<PermissionProfileRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PermissionGrantListParams {
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGrantClearParams {
    pub thread_id: String,
    #[serde(default)]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGrantRecord {
    pub thread_id: String,
    pub signature: String,
    pub permissions: Value,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGrantListResult {
    pub grants: Vec<PermissionGrantRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModeRecord {
    pub id: String,
    pub label: String,
    pub description: String,
    pub task_mode: TaskMode,
    pub permission_profile: PermissionProfile,
    pub autonomous: bool,
    pub supports_subagents: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModeListResult {
    pub modes: Vec<AgentModeRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderRecord {
    pub id: String,
    pub label: String,
    pub model_ids: Vec<String>,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
    pub supports_tools: bool,
    pub supports_web_search: bool,
    pub supports_image_generation: bool,
    pub models: Vec<ModelCapabilityRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilityRecord {
    pub id: String,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
    pub supports_tools: bool,
    pub supports_web_search: bool,
    pub supports_image_generation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderListResult {
    pub providers: Vec<ModelProviderRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationAppRecord {
    pub id: String,
    pub label: String,
    pub connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationListResult {
    pub apps: Vec<IntegrationAppRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationIDParams {
    pub integration_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationResult {
    pub app: IntegrationAppRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDisconnectResult {
    pub integration_id: String,
    pub disconnected: bool,
    pub message: String,
}
