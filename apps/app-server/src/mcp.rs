use std::{
    collections::{BTreeMap, HashSet},
    future::Future,
    sync::{Arc, RwLock},
    time::Duration,
};

use rmcp::{
    model::{
        ClientCapabilities, ClientInfo, CreateElicitationRequestParams, CreateElicitationResult,
        ElicitationAction, ErrorData, Implementation, PaginatedRequestParams, Prompt,
        ReadResourceRequestParams, Resource, ResourceTemplate, Tool,
    },
    service::{ClientInitializeError, RoleClient, RunningService},
    transport::{
        auth::OAuthState, streamable_http_client::StreamableHttpClientTransportConfig,
        StreamableHttpClientTransport, TokioChildProcess,
    },
    ClientHandler, ServiceExt,
};
use serde::Serialize;
use thiserror::Error;
use tokio::{process::Command, sync::Mutex};

use crate::interactions::InteractionBroker;
use crate::protocol::{
    InteractionContext, McpElicitationParams, McpServerStatusDetail, ServerRequestPayload,
};

const APP_SERVER_MCP_CLIENT_NAME: &str = "taskforceai-app-server";
const APP_SERVER_MCP_CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MCP_DISCOVERY_PAGES: usize = 20;
const MAX_MCP_DISCOVERY_ITEMS: usize = 500;
const MCP_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

type McpSession = RunningService<RoleClient, AppServerMcpClientHandler>;

#[derive(Debug, Error)]
pub enum AppServerMcpError {
    #[error("failed to spawn MCP child process: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("failed to initialize MCP client: {0}")]
    Initialize(#[source] Box<ClientInitializeError>),
    #[error("MCP server did not return initialize metadata")]
    MissingInitializeMetadata,
    #[error("list tools failed: {0}")]
    ListTools(#[source] rmcp::ServiceError),
    #[error("list prompts failed: {0}")]
    ListPrompts(#[source] rmcp::ServiceError),
    #[error("list resources failed: {0}")]
    ListResources(#[source] rmcp::ServiceError),
    #[error("list resource templates failed: {0}")]
    ListResourceTemplates(#[source] rmcp::ServiceError),
    #[error("read resource failed: {0}")]
    ReadResource(#[source] rmcp::ServiceError),
    #[error("MCP discovery pagination rejected: {0}")]
    Pagination(String),
    #[error("MCP {0} timed out")]
    Timeout(&'static str),
    #[error("MCP OAuth failed: {0}")]
    OAuth(String),
}

#[derive(Debug, Clone)]
pub struct AppServerMcpClientHandler {
    info: ClientInfo,
    interaction_broker: Option<InteractionBroker>,
    context_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpSnapshot {
    pub protocol_version: String,
    pub server_name: String,
    pub server_title: String,
    pub server_version: String,
    pub instructions: String,
    pub tools: Vec<AppServerMcpToolSummary>,
    pub prompts: Vec<AppServerMcpPromptSummary>,
    pub resources: Vec<AppServerMcpResourceSummary>,
    pub resource_templates: Vec<AppServerMcpResourceTemplateSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpToolSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
    pub annotations: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpPromptArgumentSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpPromptSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub arguments: Vec<AppServerMcpPromptArgumentSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpResourceSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub uri: String,
    pub mime_type: String,
    pub size: Option<u32>,
    pub annotations: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpResourceTemplateSummary {
    pub uri_template: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub mime_type: String,
    pub annotations: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct AppServerMcpManager {
    sessions: Mutex<BTreeMap<String, Arc<Mutex<McpSession>>>>,
    interaction_broker: RwLock<Option<InteractionBroker>>,
    auth_tokens: RwLock<BTreeMap<String, String>>,
    oauth_states: Mutex<BTreeMap<String, OAuthState>>,
}

impl std::fmt::Debug for AppServerMcpManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AppServerMcpManager")
            .finish_non_exhaustive()
    }
}

impl Default for AppServerMcpClientHandler {
    fn default() -> Self {
        let mut capabilities = ClientCapabilities::default();
        capabilities.elicitation = Some(Default::default());
        Self {
            info: ClientInfo::new(
                capabilities,
                Implementation::new(APP_SERVER_MCP_CLIENT_NAME, APP_SERVER_MCP_CLIENT_VERSION)
                    .with_title("TaskForceAI App Server"),
            ),
            interaction_broker: None,
            context_id: "mcp".to_string(),
        }
    }
}

impl ClientHandler for AppServerMcpClientHandler {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }

    async fn create_elicitation(
        &self,
        request: CreateElicitationRequestParams,
        _context: rmcp::service::RequestContext<RoleClient>,
    ) -> Result<CreateElicitationResult, ErrorData> {
        let Some(broker) = self.interaction_broker.clone() else {
            return Ok(CreateElicitationResult::new(ElicitationAction::Decline));
        };
        let params = match request {
            CreateElicitationRequestParams::FormElicitationParams {
                message,
                requested_schema,
                ..
            } => McpElicitationParams {
                context: InteractionContext {
                    thread_id: self.context_id.clone(),
                    turn_id: None,
                },
                server_name: self.context_id.clone(),
                mode: "form".to_string(),
                message,
                requested_schema: serde_json::to_value(requested_schema).ok(),
                url: None,
                elicitation_id: None,
            },
            CreateElicitationRequestParams::UrlElicitationParams {
                message,
                url,
                elicitation_id,
                ..
            } => McpElicitationParams {
                context: InteractionContext {
                    thread_id: self.context_id.clone(),
                    turn_id: None,
                },
                server_name: self.context_id.clone(),
                mode: "url".to_string(),
                message,
                requested_schema: None,
                url: Some(url),
                elicitation_id: Some(elicitation_id),
            },
        };
        let response = broker
            .request(
                ServerRequestPayload::McpElicitation(params),
                Duration::from_secs(300),
            )
            .await
            .map_err(|err| ErrorData::internal_error(err.to_string(), None))?;
        let action = match response
            .get("action")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("decline")
        {
            "accept" => ElicitationAction::Accept,
            "cancel" => ElicitationAction::Cancel,
            _ => ElicitationAction::Decline,
        };
        Ok(CreateElicitationResult {
            action,
            content: response.get("content").cloned(),
            meta: None,
        })
    }
}

impl AppServerMcpManager {
    pub fn set_interaction_broker(&self, broker: InteractionBroker) {
        *self
            .interaction_broker
            .write()
            .expect("mcp interaction broker lock should not be poisoned") = Some(broker);
    }

    fn client_handler(&self, context_id: &str) -> AppServerMcpClientHandler {
        AppServerMcpClientHandler {
            context_id: context_id.to_string(),
            interaction_broker: self
                .interaction_broker
                .read()
                .expect("mcp interaction broker lock should not be poisoned")
                .clone(),
            ..Default::default()
        }
    }
    pub async fn reload(&self) -> usize {
        let mut sessions = self.sessions.lock().await;
        let count = sessions.len();
        sessions.clear();
        count
    }

    pub async fn set_auth_token(&self, endpoint: &str, token: Option<String>) {
        let endpoint = endpoint.trim().to_string();
        {
            let mut tokens = self
                .auth_tokens
                .write()
                .expect("mcp auth token lock should not be poisoned");
            match token.filter(|token| !token.trim().is_empty()) {
                Some(token) => {
                    tokens.insert(endpoint.clone(), token);
                }
                None => {
                    tokens.remove(&endpoint);
                }
            }
        }
        self.evict_session(&http_session_key(&endpoint)).await;
    }

    pub fn has_auth_token(&self, endpoint: &str) -> bool {
        self.auth_tokens
            .read()
            .expect("mcp auth token lock should not be poisoned")
            .contains_key(endpoint.trim())
    }

    // coverage:ignore-start -- OAuth discovery and callback exchange require a live external authorization server.
    pub async fn start_oauth(
        &self,
        endpoint: &str,
        scopes: &[String],
        redirect_uri: &str,
    ) -> Result<String, AppServerMcpError> {
        let mut state = OAuthState::new(endpoint.trim(), None)
            .await
            .map_err(|error| AppServerMcpError::OAuth(error.to_string()))?;
        let scope_refs = scopes.iter().map(String::as_str).collect::<Vec<_>>();
        state
            .start_authorization(
                &scope_refs,
                redirect_uri.trim(),
                Some("TaskForceAI App Server"),
            )
            .await
            .map_err(|error| AppServerMcpError::OAuth(error.to_string()))?;
        let authorization_url = state
            .get_authorization_url()
            .await
            .map_err(|error| AppServerMcpError::OAuth(error.to_string()))?;
        self.oauth_states
            .lock()
            .await
            .insert(endpoint.trim().to_string(), state);
        Ok(authorization_url)
    }

    pub async fn complete_oauth(
        &self,
        endpoint: &str,
        callback_url: &str,
    ) -> Result<String, AppServerMcpError> {
        let mut state = self
            .oauth_states
            .lock()
            .await
            .remove(endpoint.trim())
            .ok_or_else(|| AppServerMcpError::OAuth("no OAuth login is pending".to_string()))?;
        if let Err(error) = state.handle_callback_url(callback_url.trim()).await {
            self.oauth_states
                .lock()
                .await
                .insert(endpoint.trim().to_string(), state);
            return Err(AppServerMcpError::OAuth(error.to_string()));
        }
        let manager = state.into_authorization_manager().ok_or_else(|| {
            AppServerMcpError::OAuth("OAuth callback did not authorize the client".to_string())
        })?;
        manager
            .get_access_token()
            .await
            .map_err(|error| AppServerMcpError::OAuth(error.to_string()))
    }
    // coverage:ignore-end

    pub async fn oauth_pending(&self, endpoint: &str) -> bool {
        self.oauth_states.lock().await.contains_key(endpoint.trim())
    }

    pub async fn read_resource_http(
        &self,
        endpoint: &str,
        uri: &str,
    ) -> Result<serde_json::Value, AppServerMcpError> {
        let key = http_session_key(endpoint);
        let session = self.http_session(&key, endpoint).await?;
        self.read_resource_session(&key, session, uri).await
    }

    pub async fn read_resource_stdio(
        &self,
        command: &str,
        args: &[String],
        uri: &str,
    ) -> Result<serde_json::Value, AppServerMcpError> {
        let key = stdio_session_key(command, args);
        let session = self.stdio_session(&key, command, args).await?;
        self.read_resource_session(&key, session, uri).await
    }

    pub async fn discover_http(
        &self,
        endpoint: &str,
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        self.discover_http_with_detail(endpoint, McpServerStatusDetail::Full)
            .await
    }

    pub async fn discover_http_with_detail(
        &self,
        endpoint: &str,
        detail: McpServerStatusDetail,
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        let key = http_session_key(endpoint);
        let session = self.http_session(&key, endpoint).await?;
        match timeout_mcp("discovery", self.discover_session(session, detail)).await {
            Ok(Ok(snapshot)) => Ok(snapshot), // coverage:ignore-line
            Ok(Err(err)) | Err(err) => {
                self.evict_session(&key).await;
                Err(err)
            }
        }
    }

    pub async fn discover_stdio(
        &self,
        command: &str,
        args: &[String],
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        self.discover_stdio_with_detail(command, args, McpServerStatusDetail::Full)
            .await
    }

    pub async fn discover_stdio_with_detail(
        &self,
        command: &str,
        args: &[String],
        detail: McpServerStatusDetail,
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        let key = stdio_session_key(command, args);
        let session = self.stdio_session(&key, command, args).await?;
        match timeout_mcp("discovery", self.discover_session(session, detail)).await {
            Ok(Ok(snapshot)) => Ok(snapshot), // coverage:ignore-line
            Ok(Err(err)) | Err(err) => {
                self.evict_session(&key).await;
                Err(err)
            }
        }
    }

    async fn discover_session(
        &self,
        session: Arc<Mutex<McpSession>>,
        detail: McpServerStatusDetail,
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        let peer_info = session
            .lock()
            .await
            .peer()
            .peer_info()
            .ok_or(AppServerMcpError::MissingInitializeMetadata)?;

        let mut snapshot = AppServerMcpSnapshot {
            protocol_version: peer_info.protocol_version.to_string(),
            server_name: trim_value(&peer_info.server_info.name),
            server_title: trim_option(peer_info.server_info.title.as_deref()),
            server_version: trim_value(&peer_info.server_info.version),
            instructions: trim_option(peer_info.instructions.as_deref()),
            tools: Vec::new(),
            prompts: Vec::new(),
            resources: Vec::new(),
            resource_templates: Vec::new(),
        };

        if peer_info.capabilities.tools.is_some() {
            let session = session.lock().await;
            snapshot.tools = list_bounded_tools(&session)
                .await?
                .into_iter()
                .map(|tool| AppServerMcpToolSummary {
                    name: tool.name.to_string(),
                    title: trim_option(tool.title.as_deref()),
                    description: trim_option(tool.description.as_deref()),
                    input_schema: serde_json::Value::Object((*tool.input_schema).clone()),
                    output_schema: tool
                        .output_schema
                        .map(|schema| serde_json::Value::Object((*schema).clone())),
                    annotations: tool
                        .annotations
                        .and_then(|annotations| serde_json::to_value(annotations).ok()),
                })
                .collect();
        } // coverage:ignore-line

        let full_detail = matches!(detail, McpServerStatusDetail::Full);
        if full_detail && peer_info.capabilities.prompts.is_some() {
            let session = session.lock().await;
            snapshot.prompts = list_bounded_prompts(&session)
                .await?
                .into_iter()
                .map(|prompt| AppServerMcpPromptSummary {
                    name: prompt.name,
                    title: trim_option(prompt.title.as_deref()),
                    description: trim_option(prompt.description.as_deref()),
                    arguments: prompt
                        .arguments
                        .unwrap_or_default()
                        .into_iter()
                        .map(|argument| AppServerMcpPromptArgumentSummary {
                            name: argument.name,
                            title: trim_option(argument.title.as_deref()),
                            description: trim_option(argument.description.as_deref()),
                            required: argument.required,
                        })
                        .collect(),
                })
                .collect();
        } // coverage:ignore-line

        if full_detail && peer_info.capabilities.resources.is_some() {
            let session = session.lock().await;
            snapshot.resources = list_bounded_resources(&session)
                .await?
                .into_iter()
                .map(|resource| AppServerMcpResourceSummary {
                    name: resource.name.clone(),
                    title: trim_option(resource.title.as_deref()),
                    description: trim_option(resource.description.as_deref()),
                    uri: resource.uri.to_string(),
                    mime_type: trim_option(resource.mime_type.as_deref()),
                    size: resource.size,
                    annotations: resource
                        .annotations
                        .and_then(|annotations| serde_json::to_value(annotations).ok()),
                })
                .collect();
            snapshot.resource_templates = list_bounded_resource_templates(&session)
                .await?
                .into_iter()
                .map(|template| AppServerMcpResourceTemplateSummary {
                    uri_template: template.uri_template.clone(),
                    name: template.name.clone(),
                    title: trim_option(template.title.as_deref()),
                    description: trim_option(template.description.as_deref()),
                    mime_type: trim_option(template.mime_type.as_deref()),
                    annotations: template
                        .annotations
                        .and_then(|annotations| serde_json::to_value(annotations).ok()),
                })
                .collect();
        } // coverage:ignore-line

        Ok(snapshot)
    }

    async fn read_resource_session(
        &self,
        key: &str,
        session: Arc<Mutex<McpSession>>,
        uri: &str,
    ) -> Result<serde_json::Value, AppServerMcpError> {
        let result = timeout_mcp("resource read", async {
            session
                .lock()
                .await
                .peer()
                .read_resource(ReadResourceRequestParams::new(uri.trim()))
                .await
                .map_err(AppServerMcpError::ReadResource)
        })
        .await;
        match result {
            Ok(Ok(result)) => Ok(serde_json::to_value(result).unwrap_or_default()),
            Ok(Err(err)) | Err(err) => {
                self.evict_session(key).await;
                Err(err)
            }
        }
    }

    async fn http_session(
        &self,
        key: &str,
        endpoint: &str,
    ) -> Result<Arc<Mutex<McpSession>>, AppServerMcpError> {
        if let Some(session) = self.sessions.lock().await.get(key).cloned() {
            return Ok(session);
        }

        let token = self
            .auth_tokens
            .read()
            .expect("mcp auth token lock should not be poisoned")
            .get(endpoint.trim())
            .cloned();
        let mut transport_config =
            StreamableHttpClientTransportConfig::with_uri(endpoint.trim().to_string());
        if let Some(token) = token {
            transport_config = transport_config.auth_header(token);
        }
        let transport = StreamableHttpClientTransport::from_config(transport_config);
        let session = timeout_mcp("initialization", self.client_handler(key).serve(transport))
            .await?
            .map_err(|err| AppServerMcpError::Initialize(Box::new(err)))?;
        // coverage:ignore-start
        let session = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .await
            .insert(key.to_string(), session.clone());
        Ok(session)
        // coverage:ignore-end
    }

    async fn stdio_session(
        &self,
        key: &str,
        command: &str,
        args: &[String],
    ) -> Result<Arc<Mutex<McpSession>>, AppServerMcpError> {
        if let Some(session) = self.sessions.lock().await.get(key).cloned() {
            return Ok(session);
        }

        let mut child = Command::new(command.trim());
        child.args(args); // coverage:ignore-line
        let transport = TokioChildProcess::new(child)?; // coverage:ignore-line
                                                        // coverage:ignore-start
        let session = timeout_mcp("initialization", self.client_handler(key).serve(transport))
            .await?
            .map_err(|err| AppServerMcpError::Initialize(Box::new(err)))?;
        let session = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .await
            .insert(key.to_string(), session.clone());
        Ok(session)
        // coverage:ignore-end
    }

    async fn evict_session(&self, key: &str) {
        self.sessions.lock().await.remove(key);
    }
}

async fn timeout_mcp<T>(
    operation: &'static str,
    future: impl Future<Output = T>,
) -> Result<T, AppServerMcpError> {
    timeout_mcp_with(MCP_OPERATION_TIMEOUT, operation, future).await
}

async fn timeout_mcp_with<T>(
    timeout: Duration,
    operation: &'static str,
    future: impl Future<Output = T>,
) -> Result<T, AppServerMcpError> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| AppServerMcpError::Timeout(operation))
}

fn http_session_key(endpoint: &str) -> String {
    format!("http:{}", endpoint.trim())
}

fn stdio_session_key(command: &str, args: &[String]) -> String {
    format!("stdio:{}\u{0}{}", command.trim(), args.join("\u{0}"))
}

async fn list_bounded_tools(session: &McpSession) -> Result<Vec<Tool>, AppServerMcpError> {
    let mut tools = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_tools(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(AppServerMcpError::ListTools)?;
        tools.extend(result.tools);
        pagination.check_items(tools.len())?;
        if pagination.advance(result.next_cursor)? {
            continue;
        }
        return Ok(tools);
    }
}

async fn list_bounded_prompts(session: &McpSession) -> Result<Vec<Prompt>, AppServerMcpError> {
    let mut prompts = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_prompts(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(AppServerMcpError::ListPrompts)?; // coverage:ignore-line
        prompts.extend(result.prompts);
        pagination.check_items(prompts.len())?;
        if pagination.advance(result.next_cursor)? {
            continue; // coverage:ignore-line
        }
        return Ok(prompts);
    }
}

async fn list_bounded_resources(session: &McpSession) -> Result<Vec<Resource>, AppServerMcpError> {
    let mut resources = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_resources(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(AppServerMcpError::ListResources)?; // coverage:ignore-line
        resources.extend(result.resources);
        pagination.check_items(resources.len())?;
        if pagination.advance(result.next_cursor)? {
            continue; // coverage:ignore-line
        }
        return Ok(resources);
    }
}

async fn list_bounded_resource_templates(
    session: &McpSession,
) -> Result<Vec<ResourceTemplate>, AppServerMcpError> {
    let mut templates = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_resource_templates(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(AppServerMcpError::ListResourceTemplates)?;
        templates.extend(result.resource_templates);
        pagination.check_items(templates.len())?;
        if pagination.advance(result.next_cursor)? {
            continue;
        }
        return Ok(templates);
    }
}

#[derive(Default)]
struct DiscoveryPagination {
    cursor: Option<String>,
    seen_cursors: HashSet<String>,
    pages: usize,
}

impl DiscoveryPagination {
    fn check_items(&self, item_count: usize) -> Result<(), AppServerMcpError> {
        if item_count > MAX_MCP_DISCOVERY_ITEMS {
            return Err(AppServerMcpError::Pagination(format!(
                "item count exceeded {MAX_MCP_DISCOVERY_ITEMS}"
            )));
        }
        Ok(())
    }

    fn advance(&mut self, next_cursor: Option<String>) -> Result<bool, AppServerMcpError> {
        self.pages += 1;
        let Some(next_cursor) = next_cursor.map(|cursor| cursor.trim().to_string()) else {
            return Ok(false);
        };
        if next_cursor.is_empty() {
            return Err(AppServerMcpError::Pagination(
                "pagination cursor did not advance".to_string(),
            ));
        }
        if self.pages >= MAX_MCP_DISCOVERY_PAGES {
            return Err(AppServerMcpError::Pagination(format!(
                "page count exceeded {MAX_MCP_DISCOVERY_PAGES}"
            )));
        }
        if !self.seen_cursors.insert(next_cursor.clone()) {
            return Err(AppServerMcpError::Pagination(
                "pagination cursor repeated".to_string(),
            ));
        }
        self.cursor = Some(next_cursor);
        Ok(true)
    }
}

fn trim_value(value: &str) -> String {
    value.trim().to_string()
}

fn trim_option(value: Option<&str>) -> String {
    value.unwrap_or_default().trim().to_string()
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;
