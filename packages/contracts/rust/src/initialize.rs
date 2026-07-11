use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ConversationRecord, MessageRecord, PendingPromptRecord, ProjectRecord, RunRecord, ServerInfo,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub server: ServerInfo,
    pub transport: TransportInfo,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportInfo {
    pub kind: String,
    pub encoding: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Capabilities {
    pub auth: bool,
    pub runs: bool,
    pub history: bool,
    pub pending_prompts: bool,
    pub projects: bool,
    pub attachments: bool,
    pub context: bool,
    pub memory: bool,
    pub mcp: bool,
    pub sync: bool,
    pub events: bool,
    pub skills: bool,
    pub plugins: bool,
    pub computer_use: bool,
    pub browser: bool,
    pub agent_sessions: bool,
    pub threads: bool,
    pub turns: bool,
    pub diagnostics: bool,
    pub channels: bool,
    pub schedules: bool,
    pub workflows: bool,
    pub voice: bool,
    pub git_review: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<AuthUserStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUserStatus {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLoginStartResult {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLoginPollResult {
    pub status: String,
    pub token: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<i64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResult {
    pub runtime: RuntimeInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListResult {
    pub runs: Vec<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchResult {
    pub query: String,
    pub runs: Vec<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummaryResult {
    pub total_runs: usize,
    pub completed_runs: usize,
    pub canceled_runs: usize,
    pub failed_runs: usize,
    pub queued_runs: usize,
    pub processing_runs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSummaryResult {
    pub transport: String,
    pub authenticated: bool,
    pub run_count: usize,
    pub model_id: String,
    pub quick_mode: bool,
    pub autonomous: bool,
    pub computer_use: bool,
    pub pet: PetState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetState {
    pub name: String,
    pub mood: String,
    pub visible: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSetParams {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub mood: Option<String>,
    #[serde(default)]
    pub visible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetResult {
    pub pet: PetState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickModeResult {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptListResult {
    pub prompts: Vec<PendingPromptRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptResult {
    pub prompt: PendingPromptRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptReplayResult {
    pub attempted: bool,
    pub prompt: Option<PendingPromptRecord>,
    pub run: Option<RunRecord>,
    pub remaining: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    pub projects: Vec<ProjectRecord>,
    pub active_project_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResult {
    pub project: ProjectRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProjectResult {
    pub active_project_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRecord {
    pub name: String,
    pub endpoint: String,
    pub tools: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerListResult {
    pub servers: Vec<McpServerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerResult {
    pub server: McpServerRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAvailableResult {
    pub servers: Vec<McpServerRecord>,
    pub adapter_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInspectResult {
    pub server: McpServerRecord,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub adapter_ready: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub server_name: String,
    pub tool_name: String,
    pub adapter_ready: bool,
    pub result: Option<Value>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationListResult {
    pub conversations: Vec<ConversationRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageListResult {
    pub messages: Vec<MessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataGetResult {
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRecord {
    pub objective: String,
    pub status: GoalStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalGetResult {
    pub goal: Option<GoalRecord>,
}
