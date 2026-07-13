use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowVisibility {
    Personal,
    Project,
    Organization,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowPhaseKind {
    Prompt,
    Fanout,
    Map,
    Reduce,
    Vote,
    Review,
    Gate,
    Artifact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBudget {
    #[serde(default)]
    pub max_cost_usd: Option<f64>,
    #[serde(default)]
    pub max_tokens: Option<u64>,
    #[serde(default)]
    pub max_seconds: Option<u64>,
    #[serde(default)]
    pub max_concurrency: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPhaseDefinition {
    pub phase_id: String,
    pub name: String,
    pub kind: WorkflowPhaseKind,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub agent_count: Option<u16>,
    #[serde(default)]
    pub output_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinitionRecord {
    pub workflow_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub version: String,
    pub visibility: WorkflowVisibility,
    #[serde(default)]
    pub args_schema: Option<Value>,
    #[serde(default)]
    pub budget: Option<WorkflowBudget>,
    #[serde(default)]
    pub phases: Vec<WorkflowPhaseDefinition>,
    #[serde(default)]
    pub output_schema: Option<Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunState {
    Queued,
    Running,
    WaitingForApproval,
    Paused,
    Completed,
    Failed,
    // Keep the double-L spelling; app runs use "canceled" on the wire.
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPhaseRunRecord {
    pub phase_id: String,
    pub state: WorkflowRunState,
    #[serde(default)]
    pub agent_run_ids: Vec<String>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRecord {
    pub run_id: String,
    pub workflow_id: String,
    pub workflow_version: String,
    pub state: WorkflowRunState,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub phase_runs: Vec<WorkflowPhaseRunRecord>,
    #[serde(default)]
    pub agent_run_ids: Vec<String>,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSaveParams {
    pub workflow: WorkflowDefinitionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowIDParams {
    pub workflow_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunIDParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunParams {
    pub workflow_id: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowListResult {
    pub workflows: Vec<WorkflowDefinitionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowResult {
    pub workflow: WorkflowDefinitionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunListResult {
    pub runs: Vec<WorkflowRunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunResult {
    pub run: WorkflowRunRecord,
}
