use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRunParams {
    pub prompt: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub quick_mode: Option<bool>,
    #[serde(default)]
    pub autonomous: Option<bool>,
    #[serde(default)]
    pub computer_use: Option<bool>,
    #[serde(default)]
    pub computer_use_target: Option<ComputerUseTarget>,
    #[serde(default)]
    pub use_logged_in_services: Option<bool>,
    #[serde(default)]
    pub agent_count: Option<u16>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default)]
    pub client_mcp_tools: Vec<ClientMcpTool>,
    #[serde(default)]
    pub private_chat: bool,
    #[serde(default)]
    pub research_workflow: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMcpTool {
    pub server_name: String,
    pub tool_name: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerUseTarget {
    Virtual,
    Local,
}

impl ComputerUseTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Virtual => "virtual",
            Self::Local => "local",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunIDParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptIDParams {
    pub pending_prompt_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIDParams {
    pub project_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub custom_instructions: Option<String>,
    #[serde(default)]
    pub workspace_roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelectParams {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerParams {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerAddParams {
    pub name: String,
    pub endpoint: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerToolsParams {
    pub name: String,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallParams {
    pub name: String,
    pub tool: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceReadParams {
    pub name: String,
    pub uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuthSetParams {
    pub name: String,
    pub access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSetEnabledParams {
    pub plugin_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSetEnabledParams {
    pub path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRootsSetParams {
    #[serde(default)]
    pub roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillWatchParams {
    #[serde(default)]
    pub previous_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentAddParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLoginPollParams {
    pub device_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecuteParams {
    pub input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchParams {
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickModeSetParams {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunModeSetParams {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalSetParams {
    pub objective: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationRoleSetParams {
    pub role: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationBudgetSetParams {
    pub budget: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridModeSetParams {
    pub enabled: bool,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettingsUpdateParams {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub telemetry_enabled: Option<bool>,
    #[serde(default)]
    pub telemetry_dsn: Option<String>,
    #[serde(default)]
    pub telemetry_environment: Option<String>,
    #[serde(default)]
    pub logging_level: Option<String>,
    #[serde(default)]
    pub logging_format: Option<String>,
    #[serde(default)]
    pub memory_enabled: Option<bool>,
    #[serde(default)]
    pub web_search_enabled: Option<bool>,
    #[serde(default)]
    pub code_execution_enabled: Option<bool>,
    #[serde(default)]
    pub trust_layer_enabled: Option<bool>,
    #[serde(default)]
    pub notifications_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSettingsCommandParams {
    pub area: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListParams {
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListParams {
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationIDParams {
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationReplaceIDParams {
    pub old_conversation_id: String,
    pub new_conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageIDParams {
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSetParams {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataGetParams {
    pub key: String,
}

fn default_history_limit() -> usize {
    50
}

fn default_search_limit() -> usize {
    10
}
