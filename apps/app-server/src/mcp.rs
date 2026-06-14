use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};

use rmcp::{
    model::{
        ClientCapabilities, ClientInfo, Implementation, PaginatedRequestParams, Prompt, Resource,
        Tool,
    },
    service::{ClientInitializeError, RoleClient, RunningService},
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ClientHandler, ServiceExt,
};
use serde::Serialize;
use thiserror::Error;
use tokio::{process::Command, sync::Mutex};

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
    #[error("MCP discovery pagination rejected: {0}")]
    Pagination(String),
}

#[derive(Debug, Clone)]
pub struct AppServerMcpClientHandler {
    info: ClientInfo,
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
}

impl Default for AppServerMcpClientHandler {
    fn default() -> Self {
        Self {
            info: ClientInfo::new(
                ClientCapabilities::default(),
                Implementation::new(APP_SERVER_MCP_CLIENT_NAME, APP_SERVER_MCP_CLIENT_VERSION)
                    .with_title("TaskForceAI App Server"),
            ),
        }
    }
}

impl ClientHandler for AppServerMcpClientHandler {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }
}

impl AppServerMcpManager {
    pub async fn discover_http(
        &self,
        endpoint: &str,
    ) -> Result<AppServerMcpSnapshot, AppServerMcpError> {
        let key = http_session_key(endpoint);
        let session = self.http_session(&key, endpoint).await?;
        match self.discover_session(session).await {
            Ok(snapshot) => Ok(snapshot),
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
            Ok(snapshot) => Ok(snapshot),
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
            .cloned()
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
        }

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
        }

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
        }

        Ok(snapshot)
    }

    async fn http_session(
        &self,
        key: &str,
        endpoint: &str,
    ) -> Result<Arc<Mutex<McpSession>>, AppServerMcpError> {
        if let Some(session) = self.sessions.lock().await.get(key).cloned() {
            return Ok(session);
        }

        let transport = StreamableHttpClientTransport::from_uri(endpoint.trim().to_string());
        let session = AppServerMcpClientHandler::default()
            .serve(transport)
            .await
            .map_err(|err| AppServerMcpError::Initialize(Box::new(err)))?;
        let session = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .await
            .insert(key.to_string(), session.clone());
        Ok(session)
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
        child.args(args);
        let transport = TokioChildProcess::new(child)?;
        let session = AppServerMcpClientHandler::default()
            .serve(transport)
            .await
            .map_err(|err| AppServerMcpError::Initialize(Box::new(err)))?;
        let session = Arc::new(Mutex::new(session));
        self.sessions
            .lock()
            .await
            .insert(key.to_string(), session.clone());
        Ok(session)
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
            .map_err(AppServerMcpError::ListPrompts)?;
        prompts.extend(result.prompts);
        pagination.check_items(prompts.len())?;
        if pagination.advance(result.next_cursor)? {
            continue;
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
            .map_err(AppServerMcpError::ListResources)?;
        resources.extend(result.resources);
        pagination.check_items(resources.len())?;
        if pagination.advance(result.next_cursor)? {
            continue;
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

    #[test]
    fn discovery_pagination_rejects_repeated_cursors() {
        let mut pagination = DiscoveryPagination::default();

        assert!(pagination.advance(Some("same".to_string())).unwrap());
        let err = pagination.advance(Some("same".to_string())).unwrap_err();

        assert!(err.to_string().contains("pagination cursor repeated"));
    }

    #[test]
    fn discovery_pagination_rejects_excessive_items() {
        let pagination = DiscoveryPagination::default();

        let err = pagination
            .check_items(MAX_MCP_DISCOVERY_ITEMS + 1)
            .unwrap_err();

        assert!(err.to_string().contains("item count exceeded"));
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
}
