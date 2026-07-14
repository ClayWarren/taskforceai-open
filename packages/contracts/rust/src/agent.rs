use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ClientMcpTool, RunRecord};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskMode {
    #[default]
    Chat,
    Work,
    Code,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionCreateParams {
    pub objective: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub task_mode: TaskMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionIDParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMessageParams {
    pub session_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRunParams {
    pub session_id: String,
    #[serde(default)]
    pub prompt: Option<String>,
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
    pub use_logged_in_services: Option<bool>,
    #[serde(default)]
    pub agent_count: Option<u16>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default)]
    pub client_mcp_tools: Vec<ClientMcpTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRecord {
    pub session_id: String,
    pub title: String,
    pub objective: String,
    pub state: String,
    pub source: String,
    #[serde(default)]
    pub task_mode: TaskMode,
    #[serde(default)]
    pub parent_session_id: Option<String>,
    #[serde(default)]
    pub last_message: Option<String>,
    #[serde(default)]
    pub run_ids: Vec<String>,
    #[serde(default)]
    pub active_run_id: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionListResult {
    pub sessions: Vec<AgentSessionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionResult {
    pub session: AgentSessionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRunResult {
    pub session: AgentSessionRecord,
    pub run: RunRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartParams {
    pub objective: String,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub task_mode: TaskMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadIDParams {
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadImportParams {
    pub thread: ThreadRecord,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadState {
    Active,
    Paused,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadItemType {
    UserMessage,
    AgentMessage,
    Reasoning,
    ToolCall,
    Approval,
    Source,
    AgentStatus,
    Error,
    SteeringMessage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadItemStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadItemRecord {
    pub id: String,
    pub turn_id: String,
    #[serde(rename = "type")]
    pub item_type: ThreadItemType,
    pub status: ThreadItemStatus,
    #[serde(default)]
    pub content: Value,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    pub id: String,
    pub thread_id: String,
    pub run_id: String,
    pub status: TurnStatus,
    #[serde(default)]
    pub items: Vec<ThreadItemRecord>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRecord {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub state: ThreadState,
    pub archived: bool,
    pub source: String,
    #[serde(default)]
    pub task_mode: TaskMode,
    #[serde(default)]
    pub parent_thread_id: Option<String>,
    #[serde(default)]
    pub turns: Vec<TurnRecord>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResult {
    pub threads: Vec<ThreadRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResult {
    pub thread: ThreadRecord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<TurnRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartParams {
    pub thread_id: String,
    pub input: String,
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
    pub use_logged_in_services: Option<bool>,
    #[serde(default)]
    pub agent_count: Option<u16>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default)]
    pub client_mcp_tools: Vec<ClientMcpTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub thread_id: String,
    pub input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub thread: ThreadRecord,
    pub turn: TurnRecord,
    pub run: RunRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadNameSetParams {
    pub thread_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMetadataUpdateParams {
    pub thread_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRollbackParams {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSection {
    pub title: String,
    pub items: Vec<DiagnosticItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInspectResult {
    pub sections: Vec<DiagnosticSection>,
    pub suggestions: Vec<String>,
}
