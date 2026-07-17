use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionContext {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandApprovalParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeApprovalParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub changes: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionApprovalParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub permissions: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputQuestion {
    pub id: String,
    pub header: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<UserInputOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputOption {
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub item_id: String,
    pub questions: Vec<UserInputQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputAnswer {
    pub answers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInputResponse {
    pub answers: BTreeMap<String, UserInputAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub server_name: String,
    pub mode: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elicitation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallParams {
    #[serde(flatten)]
    pub context: InteractionContext,
    pub call_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, Clone)]
pub enum ServerRequestPayload {
    CommandApproval(CommandApprovalParams),
    FileChangeApproval(FileChangeApprovalParams),
    PermissionApproval(PermissionApprovalParams),
    UserInput(UserInputParams),
    McpElicitation(McpElicitationParams),
    DynamicToolCall(DynamicToolCallParams),
}

impl ServerRequestPayload {
    pub fn method(&self) -> &'static str {
        match self {
            Self::CommandApproval(_) => "item/commandExecution/requestApproval",
            Self::FileChangeApproval(_) => "item/fileChange/requestApproval",
            Self::PermissionApproval(_) => "item/permissions/requestApproval",
            Self::UserInput(_) => "item/tool/requestUserInput",
            Self::McpElicitation(_) => "mcpServer/elicitation/request",
            Self::DynamicToolCall(_) => "item/tool/call",
        }
    }

    pub fn context(&self) -> &InteractionContext {
        match self {
            Self::CommandApproval(params) => &params.context,
            Self::FileChangeApproval(params) => &params.context,
            Self::PermissionApproval(params) => &params.context,
            Self::UserInput(params) => &params.context,
            Self::McpElicitation(params) => &params.context,
            Self::DynamicToolCall(params) => &params.context,
        }
    }

    pub fn into_params(self) -> serde_json::Result<Value> {
        match self {
            Self::CommandApproval(params) => serde_json::to_value(params),
            Self::FileChangeApproval(params) => serde_json::to_value(params),
            Self::PermissionApproval(params) => serde_json::to_value(params),
            Self::UserInput(params) => serde_json::to_value(params),
            Self::McpElicitation(params) => serde_json::to_value(params),
            Self::DynamicToolCall(params) => serde_json::to_value(params),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRequestResolvedParams {
    pub thread_id: String,
    pub request_id: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRequestListParams {
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingServerRequest {
    pub request: crate::JsonRpcServerRequest,
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRequestListResult {
    pub requests: Vec<PendingServerRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResponse {
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationResponse {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallResponse {
    pub content_items: Vec<Value>,
    pub success: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context() -> InteractionContext {
        InteractionContext {
            thread_id: "thread-1".to_string(),
            turn_id: Some("turn-1".to_string()),
        }
    }

    #[test]
    fn server_request_payload_variants_expose_methods_context_and_params() {
        let payloads = vec![
            ServerRequestPayload::CommandApproval(CommandApprovalParams {
                context: context(),
                item_id: "command".to_string(),
                reason: None,
                command: Some(json!(["echo", "hello"])),
                cwd: None,
            }),
            ServerRequestPayload::FileChangeApproval(FileChangeApprovalParams {
                context: context(),
                item_id: "file".to_string(),
                reason: None,
                changes: vec![json!({"path": "README.md"})],
            }),
            ServerRequestPayload::PermissionApproval(PermissionApprovalParams {
                context: context(),
                item_id: "permission".to_string(),
                reason: None,
                permissions: json!({"network": true}),
            }),
            ServerRequestPayload::UserInput(UserInputParams {
                context: context(),
                item_id: "input".to_string(),
                questions: Vec::new(),
            }),
            ServerRequestPayload::McpElicitation(McpElicitationParams {
                context: context(),
                server_name: "fixture".to_string(),
                mode: "form".to_string(),
                message: "Input".to_string(),
                requested_schema: Some(json!({"type": "object"})),
                url: None,
                elicitation_id: None,
            }),
            ServerRequestPayload::DynamicToolCall(DynamicToolCallParams {
                context: context(),
                call_id: "call".to_string(),
                namespace: Some("browser".to_string()),
                tool: "navigate".to_string(),
                arguments: json!({"url": "https://example.com"}),
            }),
        ];
        let expected_methods = [
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
            "item/permissions/requestApproval",
            "item/tool/requestUserInput",
            "mcpServer/elicitation/request",
            "item/tool/call",
        ];

        for (payload, expected_method) in payloads.into_iter().zip(expected_methods) {
            assert_eq!(payload.method(), expected_method);
            assert_eq!(payload.context().thread_id, "thread-1");
            let params = payload.into_params().expect("serialize request params");
            assert_eq!(params["threadId"], "thread-1");
            assert_eq!(params["turnId"], "turn-1");
        }
    }
}
