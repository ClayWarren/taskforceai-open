use serde::{Deserialize, Serialize};
use serde_json::Value;

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Processing,
    Completed,
    Failed,
    // Keep the single-L American spelling; workflow runs use "cancelled" on the wire.
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub prompt: String,
    pub model_id: Option<String>,
    pub project_id: Option<i64>,
    pub status: RunStatus,
    pub output: Option<String>,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_events: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_statuses: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_approval: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingPromptStatus {
    Queued,
    Pending,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPromptRecord {
    pub id: String,
    pub prompt: String,
    pub model_id: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    pub project_id: Option<i64>,
    pub status: PendingPromptStatus,
    pub retry_count: i64,
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub custom_instructions: Option<String>,
    #[serde(default)]
    pub workspace_roots: Vec<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    #[serde(default)]
    pub id: Option<i64>,
    pub conversation_id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_message_preview: Option<String>,
    #[serde(default)]
    pub sync_version: i64,
    #[serde(default)]
    pub last_synced_at: i64,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationResult {
    pub conversation: Option<ConversationRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    #[serde(default)]
    pub id: Option<i64>,
    pub message_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub is_streaming: bool,
    #[serde(default)]
    pub is_agent_status: bool,
    #[serde(default)]
    pub is_local_command_output: bool,
    #[serde(default)]
    pub elapsed_seconds: Option<f64>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub sources: Vec<Value>,
    #[serde(default)]
    pub tool_events: Vec<Value>,
    #[serde(default)]
    pub agent_statuses: Vec<Value>,
    #[serde(default)]
    pub trace_id: Option<String>,
    #[serde(default)]
    pub sync_version: i64,
    #[serde(default)]
    pub last_synced_at: i64,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageResult {
    pub message: Option<MessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChangeRecord {
    pub id: Option<i64>,
    #[serde(rename = "type")]
    pub change_type: String,
    pub entity_id: String,
    pub operation: String,
    pub data: Value,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChangeIDParams {
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChangeUpdateDataParams {
    pub id: i64,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChangeListResult {
    pub pending_changes: Vec<PendingChangeRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChangeResult {
    pub pending_change: PendingChangeRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueRecord {
    pub id: Option<i64>,
    pub conversation_id: String,
    pub prompt: String,
    pub status: String,
    #[serde(default = "default_prompt_queue_dispatch_timing")]
    pub dispatch_timing: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub model_id: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
}

fn default_prompt_queue_dispatch_timing() -> String {
    "immediate".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueIDParams {
    pub id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueDispatchAfterResponseParams {
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueListResult {
    pub queued_prompts: Vec<PromptQueueRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueResult {
    pub queued_prompt: PromptQueueRecord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptQueueDispatchResult {
    pub dispatched: bool,
    pub queued_prompt: Option<PromptQueueRecord>,
    pub run: Option<RunRecord>,
    pub remaining: usize,
    pub message: String,
}
