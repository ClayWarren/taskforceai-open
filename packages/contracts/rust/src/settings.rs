use serde::{Deserialize, Serialize};

use crate::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationRole {
    pub name: String,
    pub description: String,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationConfig {
    pub roles: Vec<OrchestrationRole>,
    pub budget: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationConfigResult {
    pub orchestration: OrchestrationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridModeResult {
    pub enabled: bool,
    pub role: String,
    pub model_id: Option<String>,
    pub recommended_model_id: String,
    pub message: String,
    pub orchestration: OrchestrationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettings {
    pub theme: String,
    pub telemetry_enabled: bool,
    pub telemetry_dsn: String,
    pub telemetry_environment: String,
    pub logging_level: String,
    pub logging_format: String,
    #[serde(default = "default_true")]
    pub memory_enabled: bool,
    #[serde(default = "default_true")]
    pub web_search_enabled: bool,
    #[serde(default = "default_true")]
    pub code_execution_enabled: bool,
    #[serde(default = "default_true")]
    pub trust_layer_enabled: bool,
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettingsResult {
    pub settings: LocalSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecord {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillListResult {
    pub skills: Vec<SkillRecord>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillWatchResult {
    pub revision: String,
    pub changed: bool,
    pub skills: Vec<SkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub enabled: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginListResult {
    pub plugins: Vec<PluginRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatusResult {
    pub supported: bool,
    pub installed: bool,
    pub permission_required: bool,
    pub locked_use_supported: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatusResult {
    pub supported: bool,
    pub installed: bool,
    pub supports_auth: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentListResult {
    pub attachments: Vec<AttachmentRecord>,
    pub max_attachments: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentAddResult {
    pub attachment: AttachmentRecord,
    pub attachments: Vec<AttachmentRecord>,
    pub max_attachments: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub category: String,
    pub label: String,
    pub estimated_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSummaryResult {
    pub max_tokens: usize,
    pub estimated_tokens: usize,
    pub items: Vec<ContextItem>,
    pub suggestions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySourceRecord {
    pub scope: String,
    pub path: String,
    pub exists: bool,
    pub bytes: usize,
    pub estimated_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySummaryResult {
    pub sources: Vec<MemorySourceRecord>,
    pub estimated_tokens: usize,
    pub suggestions: Vec<String>,
}
