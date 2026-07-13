use std::{
    collections::{BTreeMap, HashSet},
    sync::{Arc, RwLock},
    time::Duration,
};

use rmcp::{
    model::{
        ClientCapabilities, ClientInfo, CreateElicitationRequestParams, CreateElicitationResult,
        ElicitationAction, ErrorData, Implementation, PaginatedRequestParams, Prompt,
        ReadResourceRequestParams, Resource, Tool,
    },
    service::{ClientInitializeError, RoleClient, RunningService},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
        TokioChildProcess,
    },
    ClientHandler, ServiceExt,
};
use serde::Serialize;
use thiserror::Error;
use tokio::{process::Command, sync::Mutex};

use crate::interactions::InteractionBroker;
use crate::protocol::{InteractionContext, McpElicitationParams, ServerRequestPayload};

const APP_SERVER_MCP_CLIENT_NAME: &str = "taskforceai-app-server";
const APP_SERVER_MCP_CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MCP_DISCOVERY_PAGES: usize = 20;
const MAX_MCP_DISCOVERY_ITEMS: usize = 500;

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
    #[error("read resource failed: {0}")]
    ReadResource(#[source] rmcp::ServiceError),
    #[error("MCP discovery pagination rejected: {0}")]
    Pagination(String),
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
    pub tools: Vec<AppServerMcpItemSummary>,
    pub prompts: Vec<AppServerMcpItemSummary>,
    pub resources: Vec<AppServerMcpResourceSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpItemSummary {
    pub name: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppServerMcpResourceSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub uri: String,
    pub mime_type: String,
}

#[derive(Debug, Default)]
pub struct AppServerMcpManager {
    sessions: Mutex<BTreeMap<String, Arc<Mutex<McpSession>>>>,
    interaction_broker: RwLock<Option<InteractionBroker>>,
    auth_tokens: RwLock<BTreeMap<String, String>>,
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
        let key = http_session_key(endpoint);
        let session = self.http_session(&key, endpoint).await?;
        match self.discover_session(session).await {
            Ok(snapshot) => Ok(snapshot), // coverage:ignore-line
            Err(err) => {
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
        let key = stdio_session_key(command, args);
        let session = self.stdio_session(&key, command, args).await?;
        match self.discover_session(session).await {
            Ok(snapshot) => Ok(snapshot), // coverage:ignore-line
            Err(err) => {
                self.evict_session(&key).await;
                Err(err)
            }
        }
    }

    async fn discover_session(
        &self,
        session: Arc<Mutex<McpSession>>,
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
        };

        if peer_info.capabilities.tools.is_some() {
            let session = session.lock().await;
            snapshot.tools = list_bounded_tools(&session)
                .await?
                .into_iter()
                .map(|tool| AppServerMcpItemSummary {
                    name: tool.name.to_string(),
                    title: trim_option(tool.title.as_deref()),
                    description: trim_option(tool.description.as_deref()),
                })
                .collect();
        } // coverage:ignore-line

        if peer_info.capabilities.prompts.is_some() {
            let session = session.lock().await;
            snapshot.prompts = list_bounded_prompts(&session)
                .await?
                .into_iter()
                .map(|prompt| AppServerMcpItemSummary {
                    name: prompt.name,
                    title: trim_option(prompt.title.as_deref()),
                    description: trim_option(prompt.description.as_deref()),
                })
                .collect();
        } // coverage:ignore-line

        if peer_info.capabilities.resources.is_some() {
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
        let result = session
            .lock()
            .await
            .peer()
            .read_resource(ReadResourceRequestParams::new(uri.trim()))
            .await
            .map_err(AppServerMcpError::ReadResource);
        match result {
            Ok(result) => Ok(serde_json::to_value(result).unwrap_or_default()),
            Err(err) => {
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
        let session = self
            .client_handler(key)
            .serve(transport)
            .await
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
        let session = self
            .client_handler(key)
            .serve(transport)
            .await
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
mod tests {
    use super::*;

    use rmcp::{
        model::{
            CallToolRequestParams, CallToolResult, Content, ElicitationSchema, ErrorData,
            Implementation, ListPromptsResult, ListResourcesResult, ListToolsResult,
            ProtocolVersion, RawResource, ReadResourceResult, ResourceContents, ServerCapabilities,
            ServerInfo,
        },
        service::RequestContext,
        RoleServer, ServerHandler,
    };
    use taskforceai_app_protocol::OutgoingMessage;
    use tokio::task::JoinHandle;

    #[test]
    fn default_client_info_exposes_app_server_identity() {
        let info = AppServerMcpClientHandler::default().get_info();

        assert_eq!(info.protocol_version, ProtocolVersion::default());
        assert_eq!(info.client_info.name, APP_SERVER_MCP_CLIENT_NAME);
        assert_eq!(info.client_info.version, APP_SERVER_MCP_CLIENT_VERSION);
        assert_eq!(
            info.client_info.title.as_deref(),
            Some("TaskForceAI App Server")
        );
    }

    #[test]
    fn discovery_pagination_advances_stops_and_rejects_bad_cursors() {
        let mut pagination = DiscoveryPagination::default();

        assert!(pagination.advance(Some(" first ".to_string())).unwrap());
        assert_eq!(pagination.cursor.as_deref(), Some("first"));
        assert!(!pagination.advance(None).unwrap());

        let mut pagination = DiscoveryPagination::default();
        let err = pagination.advance(Some("   ".to_string())).unwrap_err();
        assert!(err
            .to_string()
            .contains("pagination cursor did not advance"));

        let mut pagination = DiscoveryPagination::default();
        assert!(pagination.advance(Some("same".to_string())).unwrap());
        let err = pagination.advance(Some("same".to_string())).unwrap_err();
        assert!(err.to_string().contains("pagination cursor repeated"));
    }

    #[test]
    fn discovery_pagination_rejects_excessive_pages_and_items() {
        let mut pagination = DiscoveryPagination::default();
        for page in 0..(MAX_MCP_DISCOVERY_PAGES - 1) {
            assert!(
                pagination.advance(Some(format!("cursor-{page}"))).unwrap(),
                "page {page} should advance"
            );
        }
        let err = pagination
            .advance(Some("cursor-limit".to_string()))
            .unwrap_err();
        assert!(err.to_string().contains("page count exceeded"));

        let pagination = DiscoveryPagination::default();
        assert!(pagination.check_items(MAX_MCP_DISCOVERY_ITEMS).is_ok());

        let err = pagination
            .check_items(MAX_MCP_DISCOVERY_ITEMS + 1)
            .unwrap_err();

        assert!(err.to_string().contains("item count exceeded"));
    }

    #[test]
    fn trim_helpers_normalize_empty_and_present_values() {
        assert_eq!(trim_value("  app-server  "), "app-server");
        assert_eq!(trim_option(Some("  title  ")), "title");
        assert_eq!(trim_option(Some("   ")), "");
        assert_eq!(trim_option(None), "");
    }

    #[test]
    fn session_keys_are_stable_and_trimmed() {
        assert_eq!(
            http_session_key(" https://example.com/mcp "),
            "http:https://example.com/mcp"
        );
        assert_eq!(
            stdio_session_key(
                " npx ",
                &[
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string()
                ]
            ),
            "stdio:npx\u{0}-y\u{0}@modelcontextprotocol/server-filesystem"
        );
    }

    struct DiscoveryFixtureServer;

    impl ServerHandler for DiscoveryFixtureServer {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(
                ServerCapabilities::builder()
                    .enable_tools()
                    .enable_prompts()
                    .enable_resources()
                    .build(),
            )
            .with_server_info(
                Implementation::new(" fixture-mcp ", " 1.2.3 ").with_title(" Fixture MCP Server "),
            )
            .with_instructions(" Use fixture tools carefully ")
        }

        async fn list_tools(
            &self,
            request: Option<PaginatedRequestParams>,
            _context: RequestContext<RoleServer>,
        ) -> Result<ListToolsResult, ErrorData> {
            let cursor = request.and_then(|params| params.cursor);
            let mut schema = serde_json::Map::new();
            schema.insert(
                "type".to_string(),
                serde_json::Value::String("object".to_string()),
            );

            match cursor.as_deref() {
                None => {
                    let mut tool = Tool::new("fixture_search", " Search fixture docs ", schema);
                    tool.title = Some(" Fixture Search ".to_string());
                    Ok(ListToolsResult {
                        tools: vec![tool],
                        next_cursor: Some(" second ".to_string()),
                        ..Default::default()
                    })
                }
                Some("second") => {
                    let mut tool = Tool::new("fixture_read", " Read fixture resource ", schema);
                    tool.title = Some(" Fixture Read ".to_string());
                    Ok(ListToolsResult {
                        tools: vec![tool],
                        ..Default::default()
                    })
                }
                other => Err(ErrorData::invalid_request(
                    format!("unexpected cursor: {other:?}"),
                    None,
                )),
            }
        }

        async fn list_prompts(
            &self,
            _request: Option<PaginatedRequestParams>,
            _context: RequestContext<RoleServer>,
        ) -> Result<ListPromptsResult, ErrorData> {
            Ok(ListPromptsResult {
                prompts: vec![Prompt::new(
                    "fixture_prompt",
                    Some(" Summarize fixture data "),
                    None,
                )
                .with_title(" Fixture Prompt ")],
                ..Default::default()
            })
        }

        async fn list_resources(
            &self,
            _request: Option<PaginatedRequestParams>,
            _context: RequestContext<RoleServer>,
        ) -> Result<ListResourcesResult, ErrorData> {
            Ok(ListResourcesResult {
                resources: vec![Resource::new(
                    RawResource {
                        uri: "file:///fixture/readme.md".to_string(),
                        name: "fixture_readme".to_string(),
                        title: Some(" Fixture Readme ".to_string()),
                        description: Some(" Fixture resource docs ".to_string()),
                        mime_type: Some(" text/markdown ".to_string()),
                        size: None,
                        icons: None,
                        meta: None,
                    },
                    None,
                )],
                ..Default::default()
            })
        }

        async fn read_resource(
            &self,
            request: ReadResourceRequestParams,
            _context: RequestContext<RoleServer>,
        ) -> Result<ReadResourceResult, ErrorData> {
            Ok(ReadResourceResult::new(vec![ResourceContents::text(
                "fixture contents",
                request.uri,
            )]))
        }

        async fn call_tool(
            &self,
            request: CallToolRequestParams,
            _context: RequestContext<RoleServer>,
        ) -> Result<CallToolResult, ErrorData> {
            Ok(CallToolResult::success(vec![Content::text(format!(
                "called {}",
                request.name
            ))]))
        }
    }

    struct FailingToolsServer;

    impl ServerHandler for FailingToolsServer {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
                .with_server_info(Implementation::new("failing-tools", "1.0.0"))
        }

        async fn list_tools(
            &self,
            _request: Option<PaginatedRequestParams>,
            _context: RequestContext<RoleServer>,
        ) -> Result<ListToolsResult, ErrorData> {
            Err(ErrorData::internal_error(
                "tool listing failed".to_string(),
                None,
            ))
        }
    }

    struct FailingResourceServer;

    impl ServerHandler for FailingResourceServer {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(ServerCapabilities::builder().enable_resources().build())
                .with_server_info(Implementation::new("failing-resource", "1.0.0"))
        }

        async fn read_resource(
            &self,
            _request: ReadResourceRequestParams,
            _context: RequestContext<RoleServer>,
        ) -> Result<ReadResourceResult, ErrorData> {
            Err(ErrorData::internal_error("read failed".to_string(), None))
        }
    }

    struct ElicitationFixtureServer;

    impl ServerHandler for ElicitationFixtureServer {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
                .with_server_info(Implementation::new("elicitation-fixture", "1.0.0"))
        }

        async fn call_tool(
            &self,
            request: CallToolRequestParams,
            context: RequestContext<RoleServer>,
        ) -> Result<CallToolResult, ErrorData> {
            let params = if request.name == "url" {
                CreateElicitationRequestParams::UrlElicitationParams {
                    meta: None,
                    message: "Open the fixture form".to_string(),
                    url: "https://example.com/form".to_string(),
                    elicitation_id: "fixture-elicitation".to_string(),
                }
            } else {
                CreateElicitationRequestParams::FormElicitationParams {
                    meta: None,
                    message: "Enter a fixture name".to_string(),
                    requested_schema: ElicitationSchema::builder()
                        .string_property("name", |property| property)
                        .build()
                        .expect("valid fixture schema"),
                }
            };
            let result = context
                .peer
                .create_elicitation(params)
                .await
                .map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
            Ok(CallToolResult::success(vec![Content::text(format!(
                "{:?}",
                result.action
            ))]))
        }
    }

    async fn cached_session_for_server<S>(server: S) -> (Arc<Mutex<McpSession>>, JoinHandle<()>)
    where
        S: ServerHandler + Send + Sync + 'static,
    {
        let (server_transport, client_transport) = tokio::io::duplex(4096);
        let server_handle = tokio::spawn(async move {
            let server = server
                .serve(server_transport)
                .await
                .expect("server should initialize");
            server.waiting().await.expect("server should stop cleanly");
        });
        let session = AppServerMcpClientHandler::default()
            .serve(client_transport)
            .await
            .expect("client should initialize");

        (Arc::new(Mutex::new(session)), server_handle)
    }

    async fn elicitation_session(
        handler: AppServerMcpClientHandler,
    ) -> (Arc<Mutex<McpSession>>, JoinHandle<()>) {
        let (server_transport, client_transport) = tokio::io::duplex(4096);
        let server_handle = tokio::spawn(async move {
            let server = ElicitationFixtureServer
                .serve(server_transport)
                .await
                .expect("server should initialize");
            server.waiting().await.expect("server should stop cleanly");
        });
        let session = handler
            .serve(client_transport)
            .await
            .expect("client should initialize");
        (Arc::new(Mutex::new(session)), server_handle)
    }

    #[tokio::test]
    async fn elicitation_handler_declines_without_a_broker() {
        let (session, server_handle) =
            elicitation_session(AppServerMcpClientHandler::default()).await;
        let result = session
            .lock()
            .await
            .peer()
            .call_tool(CallToolRequestParams::new("form"))
            .await
            .expect("fixture call should complete");
        assert_eq!(result.content[0].as_text().expect("text").text, "Decline");
        session.lock().await.close().await.expect("close client");
        server_handle.await.expect("server task");
    }

    #[tokio::test]
    async fn elicitation_handler_maps_form_url_and_response_actions() {
        for (tool, response, expected_action) in [
            (
                "form",
                serde_json::json!({"action": "accept", "content": {"name": "Ada"}}),
                "Accept",
            ),
            ("url", serde_json::json!({"action": "cancel"}), "Cancel"),
            ("form", serde_json::json!({"action": "other"}), "Decline"),
        ] {
            let (output, mut messages) = tokio::sync::mpsc::channel(8);
            let broker = InteractionBroker::new(output);
            let handler = AppServerMcpClientHandler {
                interaction_broker: Some(broker.clone()),
                context_id: "fixture-context".to_string(),
                ..Default::default()
            };
            let (session, server_handle) = elicitation_session(handler).await;
            let call = {
                let session = session.clone();
                let tool = tool.to_string();
                tokio::spawn(async move {
                    session
                        .lock()
                        .await
                        .peer()
                        .call_tool(CallToolRequestParams::new(tool))
                        .await
                })
            };
            let OutgoingMessage::Request(request) = messages.recv().await.expect("elicitation")
            else {
                panic!("expected elicitation request");
            };
            assert_eq!(request.method, "mcpServer/elicitation/request");
            assert_eq!(request.params["threadId"], "fixture-context");
            assert_eq!(request.params["serverName"], "fixture-context");
            if tool == "url" {
                assert_eq!(request.params["mode"], "url");
                assert_eq!(request.params["url"], "https://example.com/form");
            } else {
                assert_eq!(request.params["mode"], "form");
                assert!(request.params["requestedSchema"].is_object());
            }
            assert!(
                broker
                    .resolve(taskforceai_app_protocol::JsonRpcResponse {
                        jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
                        id: Some(request.id),
                        result: Some(response),
                        error: None,
                    })
                    .await
            );
            let result = call
                .await
                .expect("call task")
                .expect("fixture call should complete");
            assert_eq!(
                result.content[0].as_text().expect("text").text,
                expected_action
            );
            let _ = messages.recv().await.expect("resolved notification");
            session.lock().await.close().await.expect("close client");
            server_handle.await.expect("server task");
        }

        let (output, output_rx) = tokio::sync::mpsc::channel(1);
        drop(output_rx);
        let handler = AppServerMcpClientHandler {
            interaction_broker: Some(InteractionBroker::new(output)),
            ..Default::default()
        };
        let (session, server_handle) = elicitation_session(handler).await;
        assert!(session
            .lock()
            .await
            .peer()
            .call_tool(CallToolRequestParams::new("form"))
            .await
            .is_err());
        session.lock().await.close().await.expect("close client");
        server_handle.await.expect("server task");
    }

    #[tokio::test]
    async fn discover_session_lists_capabilities_through_in_process_mcp() {
        let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;

        let snapshot = AppServerMcpManager::default()
            .discover_session(session.clone())
            .await
            .expect("discovery should succeed");

        assert_eq!(
            snapshot.protocol_version,
            ProtocolVersion::default().to_string()
        );
        assert_eq!(snapshot.server_name, "fixture-mcp");
        assert_eq!(snapshot.server_title, "Fixture MCP Server");
        assert_eq!(snapshot.server_version, "1.2.3");
        assert_eq!(snapshot.instructions, "Use fixture tools carefully");
        assert_eq!(snapshot.tools.len(), 2);
        assert_eq!(snapshot.tools[0].name, "fixture_search");
        assert_eq!(snapshot.tools[0].title, "Fixture Search");
        assert_eq!(snapshot.tools[0].description, "Search fixture docs");
        assert_eq!(snapshot.tools[1].name, "fixture_read");
        assert_eq!(snapshot.prompts.len(), 1);
        assert_eq!(snapshot.prompts[0].title, "Fixture Prompt");
        assert_eq!(snapshot.prompts[0].description, "Summarize fixture data");
        assert_eq!(snapshot.resources.len(), 1);
        assert_eq!(snapshot.resources[0].name, "fixture_readme");
        assert_eq!(snapshot.resources[0].title, "Fixture Readme");
        assert_eq!(snapshot.resources[0].description, "Fixture resource docs");
        assert_eq!(snapshot.resources[0].uri, "file:///fixture/readme.md");
        assert_eq!(snapshot.resources[0].mime_type, "text/markdown");

        session
            .lock()
            .await
            .close()
            .await
            .expect("client should close");
        server_handle.await.expect("server task should finish");
    }

    #[tokio::test]
    async fn cached_sessions_return_without_spawning_and_errors_evict_cache_entries() {
        let manager = AppServerMcpManager::default();
        let endpoint = "http://cached.example/mcp";
        let http_key = http_session_key(endpoint);
        let (session, server_handle) = cached_session_for_server(FailingToolsServer).await;
        manager
            .sessions
            .lock()
            .await
            .insert(http_key.clone(), session.clone());

        let err = manager
            .discover_http(endpoint)
            .await
            .expect_err("cached HTTP discovery should surface list failure");
        assert!(matches!(err, AppServerMcpError::ListTools(_)));
        assert!(!manager.sessions.lock().await.contains_key(&http_key));
        session
            .lock()
            .await
            .close()
            .await
            .expect("client should close");
        server_handle.await.expect("server task should finish");

        let command = "cached-command";
        let args = vec!["--fixture".to_string()];
        let stdio_key = stdio_session_key(command, &args);
        let (session, server_handle) = cached_session_for_server(FailingToolsServer).await;
        manager
            .sessions
            .lock()
            .await
            .insert(stdio_key.clone(), session.clone());

        let err = manager
            .discover_stdio(command, &args)
            .await
            .expect_err("cached stdio discovery should surface list failure");
        assert!(matches!(err, AppServerMcpError::ListTools(_)));
        assert!(!manager.sessions.lock().await.contains_key(&stdio_key));
        session
            .lock()
            .await
            .close()
            .await
            .expect("client should close");
        server_handle.await.expect("server task should finish");
    }

    #[tokio::test]
    async fn cached_sessions_support_resource_reads_and_reload() {
        let manager = AppServerMcpManager::default();
        let endpoint = "http://fixture.example/mcp";
        let key = http_session_key(endpoint);
        let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;
        manager.sessions.lock().await.insert(key, session.clone());

        let resource = manager
            .read_resource_http(endpoint, "file:///fixture/readme.md")
            .await
            .expect("resource read should succeed");
        assert_eq!(resource["contents"][0]["text"], "fixture contents");

        assert_eq!(manager.reload().await, 1);
        assert_eq!(manager.reload().await, 0);
        manager
            .set_auth_token(endpoint, Some("oauth-token".to_string()))
            .await;
        assert_eq!(
            manager
                .auth_tokens
                .read()
                .expect("auth tokens")
                .get(endpoint)
                .map(String::as_str),
            Some("oauth-token")
        );
        manager.set_auth_token(endpoint, None).await;
        assert!(!manager
            .auth_tokens
            .read()
            .expect("auth tokens")
            .contains_key(endpoint));

        session
            .lock()
            .await
            .close()
            .await
            .expect("client should close");
        server_handle.await.expect("server task should finish");
    }

    #[tokio::test]
    async fn cached_stdio_resource_reads_work_and_failures_evict_sessions() {
        let manager = AppServerMcpManager::default();
        let command = "fixture-command";
        let args = vec!["--fixture".to_string()];
        let key = stdio_session_key(command, &args);
        let (session, server_handle) = cached_session_for_server(DiscoveryFixtureServer).await;
        manager
            .sessions
            .lock()
            .await
            .insert(key.clone(), session.clone());
        let resource = manager
            .read_resource_stdio(command, &args, " file:///fixture/readme.md ")
            .await
            .expect("cached stdio resource read");
        assert_eq!(resource["contents"][0]["text"], "fixture contents");
        session.lock().await.close().await.expect("close client");
        server_handle.await.expect("server task");

        let (session, server_handle) = cached_session_for_server(FailingResourceServer).await;
        manager
            .sessions
            .lock()
            .await
            .insert(key.clone(), session.clone());
        assert!(manager
            .read_resource_stdio(command, &args, "file:///failure")
            .await
            .is_err());
        assert!(!manager.sessions.lock().await.contains_key(&key));
        session.lock().await.close().await.expect("close client");
        server_handle.await.expect("server task");
    }

    #[tokio::test]
    async fn discovery_constructors_map_failures_and_keep_cache_clean() {
        let manager = AppServerMcpManager::default();

        manager
            .set_auth_token("http://127.0.0.1:9/mcp", Some(" token ".to_string()))
            .await;

        let http_err = manager
            .discover_http("http://127.0.0.1:9/mcp")
            .await
            .expect_err("unreachable HTTP MCP should fail initialization");
        assert!(matches!(http_err, AppServerMcpError::Initialize(_)));
        assert!(manager.sessions.lock().await.is_empty());

        let stdio_err = manager
            .discover_stdio("/definitely/missing/taskforceai-mcp", &[])
            .await
            .expect_err("missing stdio MCP command should fail spawn");
        assert!(matches!(stdio_err, AppServerMcpError::Spawn(_)));
        assert!(manager.sessions.lock().await.is_empty());
    }
}
