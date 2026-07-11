use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};

pub struct ApiHealth {
    pub healthy: bool,
    pub status: u16,
}

#[derive(Debug, Clone)]
pub struct ApiSubmitRunRequest {
    pub prompt: String,
    pub model_id: Option<String>,
    pub reasoning_effort: Option<String>,
    pub quick_mode: bool,
    pub autonomous: bool,
    pub computer_use: bool,
    pub computer_use_target: Option<String>,
    pub use_logged_in_services: bool,
    pub agent_count: Option<u16>,
    pub project_id: Option<i64>,
    pub attachment_ids: Vec<String>,
    pub role_models: BTreeMap<String, String>,
    pub budget: Option<f64>,
    pub mcp_servers: Vec<ApiSubmitMcpServer>,
    pub client_mcp_tools: Vec<ApiSubmitMcpTool>,
    pub private_chat: bool,
    pub research_workflow: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct ApiSubmitMcpServer {
    pub name: String,
    pub tools: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct ApiSubmitMcpTool {
    pub server_name: String,
    pub tool_name: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

impl ApiSubmitRunRequest {
    pub(super) fn to_body(&self) -> Value {
        let mut body = json!({
            "prompt": self.prompt,
        });
        if let Some(model_id) = self.model_id.as_deref().filter(|value| !value.is_empty()) {
            body["modelId"] = json!(model_id);
        }
        if let Some(reasoning_effort) = self
            .reasoning_effort
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            body["reasoningEffort"] = json!(reasoning_effort);
        }
        if let Some(project_id) = self.project_id {
            body["projectId"] = json!(project_id);
        }
        if !self.attachment_ids.is_empty() {
            body["attachment_ids"] = json!(self.attachment_ids);
        }
        if !self.role_models.is_empty() {
            body["role_models"] = json!(self.role_models);
        }
        if let Some(budget) = self.budget.filter(|budget| *budget > 0.0) {
            body["budget"] = json!(budget);
        }
        if self.private_chat {
            body["private_chat"] = json!(true);
        }
        let mut client_tools = build_mcp_client_tools(&self.mcp_servers);
        client_tools.extend(build_explicit_mcp_client_tools(&self.client_mcp_tools));
        let quick_mode_enabled = self.quick_mode && !self.computer_use;
        if quick_mode_enabled
            || self.autonomous
            || self.computer_use
            || self.use_logged_in_services
            || self.research_workflow.is_some()
            || !client_tools.is_empty()
        {
            let mut options = serde_json::Map::new();
            if quick_mode_enabled {
                options.insert("quickModeEnabled".to_string(), json!(true));
            } else if self.computer_use {
                options.insert("quickModeEnabled".to_string(), json!(false));
            }
            if self.autonomous {
                options.insert("autonomyEnabled".to_string(), json!(true));
            }
            if self.computer_use {
                options.insert("computerUseEnabled".to_string(), json!(true));
                if let Some(target) = self.computer_use_target.as_deref() {
                    options.insert("computerUseTarget".to_string(), json!(target));
                }
            }
            if self.computer_use && self.use_logged_in_services {
                options.insert("useLoggedInServices".to_string(), json!(true));
            }
            if let Some(agent_count) = self.agent_count.filter(|count| *count > 0) {
                options.insert("agentCount".to_string(), json!(agent_count));
            }
            if !client_tools.is_empty() {
                options.insert("clientTools".to_string(), json!({ "mcp": client_tools }));
            }
            if let Some(research_workflow) = &self.research_workflow {
                options.insert("researchWorkflow".to_string(), research_workflow.clone());
            }
            body["options"] = Value::Object(options);
        }
        body
    }
}

fn build_mcp_client_tools(servers: &[ApiSubmitMcpServer]) -> Vec<Value> {
    servers
        .iter()
        .filter(|server| server.enabled)
        .flat_map(|server| {
            let server_name = server.name.trim();
            server.tools.iter().filter_map(move |tool| {
                let tool_name = tool.trim();
                if server_name.is_empty()
                    || tool_name.is_empty()
                    || is_sensitive_local_mcp_tool(server_name, tool_name)
                {
                    return None;
                }
                Some(json!({
                    "source": "mcp",
                    "serverName": server_name,
                    "toolName": tool_name,
                    "title": tool_name,
                    "description": "",
                }))
            })
        })
        .collect()
}

fn build_explicit_mcp_client_tools(tools: &[ApiSubmitMcpTool]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|tool| {
            let server_name = tool.server_name.trim();
            let tool_name = tool.tool_name.trim();
            if server_name.is_empty()
                || tool_name.is_empty()
                || is_sensitive_local_mcp_tool(server_name, tool_name)
            {
                return None;
            }
            Some(json!({
                "source": "mcp",
                "serverName": server_name,
                "toolName": tool_name,
                "title": tool.title.as_deref().unwrap_or(tool_name),
                "description": tool.description.as_deref().unwrap_or_default(),
            }))
        })
        .collect()
}

fn is_sensitive_local_mcp_tool(server_name: &str, tool_name: &str) -> bool {
    server_name == "workspace" || (server_name == "workspace-shell" && tool_name == "bash")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSubmitRunResponse {
    #[serde(alias = "task_id")]
    pub task_id: String,
    #[serde(
        default,
        alias = "conversation_id",
        deserialize_with = "optional_string_from_value"
    )]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiAttachmentUploadResponse {
    pub id: String,
    pub mime_type: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub chunk: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub error: String,
    #[serde(default)]
    pub sources: Vec<Value>,
    #[serde(default, alias = "tool_usage")]
    pub tool_events: Vec<Value>,
    #[serde(default, alias = "tool_event")]
    pub tool_event: Option<Value>,
    #[serde(default, alias = "agent_statuses")]
    pub agent_statuses: Vec<Value>,
    #[serde(default, alias = "pending_approval")]
    pub pending_approval: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiDeviceLoginStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: i64,
    pub interval: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiDeviceLoginPoll {
    pub status: String,
    pub access_token: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<i64>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiDeviceLoginPollWire {
    status: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default, rename = "accessToken")]
    access_token_compat: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    interval: Option<i64>,
    #[serde(default)]
    message: Option<String>,
}

fn select_access_token(primary: Option<String>, fallback: Option<String>) -> Option<String> {
    primary
        .filter(|token| !token.is_empty())
        .or_else(|| fallback.filter(|token| !token.is_empty()))
}

impl<'de> Deserialize<'de> for ApiDeviceLoginPoll {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = ApiDeviceLoginPollWire::deserialize(deserializer)?;
        Ok(Self {
            status: wire.status,
            access_token: select_access_token(wire.access_token, wire.access_token_compat),
            expires_in: wire.expires_in,
            interval: wire.interval,
            message: wire.message,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiModelSelectorResponse {
    pub enabled: bool,
    pub options: Vec<ApiModelOption>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiModelOption {
    pub id: String,
    pub label: String,
    pub badge: String,
    pub description: Option<String>,
    #[serde(default)]
    pub usage_multiple: Option<f64>,
    #[serde(default)]
    pub reasoning_effort_levels: Vec<String>,
    #[serde(default)]
    pub default_reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSyncPullRequest {
    pub device_id: String,
    pub last_sync_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSyncPullResponse {
    pub conversations: Vec<Value>,
    pub messages: Vec<Value>,
    pub deletions: Vec<Value>,
    pub latest_version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSyncPushRequest {
    pub conversations: Vec<Value>,
    pub messages: Vec<Value>,
    pub deletions: Vec<Value>,
    pub device_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSyncPushResponse {
    pub accepted: Vec<String>,
    pub conflicts: Vec<Value>,
    pub new_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSyncRealtimePollResponse {
    #[serde(default)]
    pub messages: Vec<ApiSyncRealtimeMessage>,
    #[serde(default)]
    pub last_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiSyncRealtimeMessage {
    #[serde(rename = "type")]
    pub event_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiProject {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub custom_instructions: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCreateProjectRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiArtifact {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub status: String,
    pub visibility: String,
    #[serde(default)]
    pub current_version_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub current_version: Option<ApiArtifactVersion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiArtifactVersion {
    pub id: String,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default, alias = "bytes")]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiArtifactShare {
    pub token: String,
    pub url: String,
    pub artifact: ApiArtifact,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApiCsrfResponse {
    pub(super) csrf_token: String,
}

fn optional_string_from_value<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        Some(Value::String(value)) if !value.is_empty() => Some(value),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    })
}
