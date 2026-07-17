use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, ClientCapabilities, ClientInfo, Implementation,
        JsonObject, PaginatedRequestParams, Prompt, Resource, Tool,
    },
    service::{ClientInitializeError, RoleClient, RunningService},
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ClientHandler, ServiceError, ServiceExt,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    process::Command,
    sync::Mutex as AsyncMutex,
    time::{timeout, Duration},
};

const DESKTOP_MCP_CLIENT_NAME: &str = "taskforceai-desktop";
const DESKTOP_MCP_CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
const ALLOW_LOCAL_PROCESS_MCP_ENV: &str = "TASKFORCEAI_DESKTOP_ALLOW_LOCAL_PROCESS_MCP";
const MAX_MCP_DISCOVERY_PAGES: usize = 20;
const MAX_MCP_DISCOVERY_ITEMS: usize = 500;

pub type DesktopMcpSession = RunningService<RoleClient, DesktopMcpClientHandler>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopMcpEndpointKind {
    Stdio,
    StreamableHttp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpEndpointSpec {
    pub kind: DesktopMcpEndpointKind,
    pub raw: String,
    pub url: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpServerConfig {
    pub name: String,
    pub endpoint: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpToolSummary {
    pub name: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpPromptSummary {
    pub name: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpResourceSummary {
    pub name: String,
    pub title: String,
    pub description: String,
    pub uri: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMcpServerSnapshot {
    pub name: String,
    pub endpoint: String,
    pub transport: DesktopMcpEndpointKind,
    pub protocol_version: String,
    pub server_name: String,
    pub server_title: String,
    pub server_version: String,
    pub instructions: String,
    pub tools: Vec<DesktopMcpToolSummary>,
    pub prompts: Vec<DesktopMcpPromptSummary>,
    pub resources: Vec<DesktopMcpResourceSummary>,
}

#[derive(Debug, Error)]
pub enum DesktopMcpConnectError {
    #[error("failed to spawn MCP child process: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("failed to initialize MCP client: {0}")]
    Initialize(#[source] Box<ClientInitializeError>),
}

#[derive(Debug, Error)]
pub enum DesktopMcpManagerError {
    #[error("MCP server name is required")]
    MissingName,
    #[error("MCP server {0} is disabled")]
    Disabled(String),
    #[error("endpoint is required")]
    MissingEndpoint,
    #[error("unsupported MCP endpoint scheme {0}")]
    UnsupportedScheme(String),
    #[error("stdio endpoint is missing a command")]
    MissingCommand,
    #[error(
        "local-process MCP endpoints require TASKFORCEAI_DESKTOP_ALLOW_LOCAL_PROCESS_MCP=true"
    )]
    LocalProcessMcpDisabled,
    #[error("unterminated escape sequence in command")]
    UnterminatedEscape,
    #[error("unterminated quoted string in command")]
    UnterminatedQuote,
    #[error("connect to {server} failed: {source}")]
    Connect {
        server: String,
        #[source]
        source: Box<DesktopMcpConnectError>,
    },
    #[error("MCP server {server} did not return initialize metadata")]
    MissingInitializeMetadata { server: String },
    #[error("MCP operation {operation} for {server} timed out")]
    OperationTimeout {
        server: String,
        operation: &'static str,
    },
    #[error("list tools for {server} failed: {source}")]
    ListTools {
        server: String,
        #[source]
        source: ServiceError,
    },
    #[error("list prompts for {server} failed: {source}")]
    ListPrompts {
        server: String,
        #[source]
        source: ServiceError,
    },
    #[error("list resources for {server} failed: {source}")]
    ListResources {
        server: String,
        #[source]
        source: ServiceError,
    },
    #[error("MCP discovery pagination for {server} rejected: {reason}")]
    Pagination { server: String, reason: String },
    #[error("tool name is required")]
    MissingToolName,
    #[error("call tool {tool} on {server} failed: {source}")]
    CallTool {
        server: String,
        tool: String,
        #[source]
        source: ServiceError,
    },
}

#[derive(Debug, Clone)]
pub struct DesktopMcpClientHandler {
    info: ClientInfo,
}

#[derive(Debug)]
struct ManagedSession {
    server: DesktopMcpServerConfig,
    spec: DesktopMcpEndpointSpec,
    session: Arc<AsyncMutex<DesktopMcpSession>>,
}

#[derive(Debug)]
pub struct DesktopMcpManager {
    sessions: Mutex<HashMap<String, ManagedSession>>,
    connect_lock: AsyncMutex<()>,
}

impl Default for DesktopMcpManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            connect_lock: AsyncMutex::new(()),
        }
    }
}

impl Default for DesktopMcpClientHandler {
    fn default() -> Self {
        Self {
            info: ClientInfo::new(
                ClientCapabilities::default(),
                Implementation::new(DESKTOP_MCP_CLIENT_NAME, DESKTOP_MCP_CLIENT_VERSION)
                    .with_title("TaskForceAI Desktop"),
            ),
        }
    }
}

impl ClientHandler for DesktopMcpClientHandler {
    fn get_info(&self) -> ClientInfo {
        self.info.clone()
    }
}

impl DesktopMcpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn discover(
        &self,
        server: DesktopMcpServerConfig,
    ) -> Result<DesktopMcpServerSnapshot, DesktopMcpManagerError> {
        let managed = self.ensure_connected(server).await?;
        let peer_info = managed
            .session
            .lock()
            .await
            .peer()
            .peer_info()
            .ok_or_else(|| DesktopMcpManagerError::MissingInitializeMetadata {
                server: managed.server.name.clone(),
            })?;

        let mut snapshot = DesktopMcpServerSnapshot {
            name: managed.server.name.clone(),
            endpoint: managed.server.endpoint.clone(),
            transport: managed.spec.kind.clone(),
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
            let session = managed.session.lock().await;
            snapshot.tools = timeout(
                MCP_OPERATION_TIMEOUT,
                list_bounded_tools(&session, &managed.server.name),
            )
            .await
            .map_err(|_| DesktopMcpManagerError::OperationTimeout {
                server: managed.server.name.clone(),
                operation: "list_tools",
            })?
            .map(|tools| {
                tools
                    .into_iter()
                    .map(|tool| DesktopMcpToolSummary {
                        name: tool.name.to_string(),
                        title: trim_option(tool.title.as_deref()),
                        description: trim_option(tool.description.as_deref()),
                    })
                    .collect()
            })?;
        }

        if peer_info.capabilities.prompts.is_some() {
            let session = managed.session.lock().await;
            snapshot.prompts = timeout(
                MCP_OPERATION_TIMEOUT,
                list_bounded_prompts(&session, &managed.server.name),
            )
            .await
            .map_err(|_| DesktopMcpManagerError::OperationTimeout {
                server: managed.server.name.clone(),
                operation: "list_prompts",
            })?
            .map(|prompts| {
                prompts
                    .into_iter()
                    .map(|prompt| DesktopMcpPromptSummary {
                        name: prompt.name,
                        title: trim_option(prompt.title.as_deref()),
                        description: trim_option(prompt.description.as_deref()),
                    })
                    .collect()
            })?;
        }

        if peer_info.capabilities.resources.is_some() {
            let session = managed.session.lock().await;
            snapshot.resources = timeout(
                MCP_OPERATION_TIMEOUT,
                list_bounded_resources(&session, &managed.server.name),
            )
            .await
            .map_err(|_| DesktopMcpManagerError::OperationTimeout {
                server: managed.server.name.clone(),
                operation: "list_resources",
            })?
            .map(|resources| {
                resources
                    .into_iter()
                    .map(|resource| DesktopMcpResourceSummary {
                        name: resource.name.clone(),
                        title: trim_option(resource.title.as_deref()),
                        description: trim_option(resource.description.as_deref()),
                        uri: resource.uri.to_string(),
                        mime_type: trim_option(resource.mime_type.as_deref()),
                    })
                    .collect()
            })?;
        }

        Ok(snapshot)
    }

    pub async fn call_tool(
        &self,
        server: DesktopMcpServerConfig,
        name: impl Into<String>,
        arguments: JsonObject,
    ) -> Result<CallToolResult, DesktopMcpManagerError> {
        let tool_name = name.into().trim().to_owned();
        if tool_name.is_empty() {
            return Err(DesktopMcpManagerError::MissingToolName);
        }
        let managed = self.ensure_connected(server).await?;

        let params = if arguments.is_empty() {
            CallToolRequestParams::new(tool_name.clone())
        } else {
            CallToolRequestParams::new(tool_name.clone()).with_arguments(arguments)
        };

        let session = managed.session.lock().await;
        let result = timeout(MCP_OPERATION_TIMEOUT, session.peer().call_tool(params))
            .await
            .map_err(|_| DesktopMcpManagerError::OperationTimeout {
                server: managed.server.name.clone(),
                operation: "call_tool",
            })?
            .map_err(|source| DesktopMcpManagerError::CallTool {
                server: managed.server.name.clone(),
                tool: tool_name,
                source,
            });
        result
    }

    pub async fn close(&self, name: &str) -> Result<(), tokio::task::JoinError> {
        let key = normalize_server_key(name);
        if key.is_empty() {
            return Ok(());
        }

        let managed = {
            let mut sessions = self.sessions.lock().expect("mcp session lock poisoned");
            sessions.remove(&key)
        };

        if let Some(managed) = managed {
            let _ = managed.session.lock().await.close().await?;
        }
        Ok(())
    }

    pub async fn close_all(&self) -> Result<(), tokio::task::JoinError> {
        let sessions = {
            let mut sessions = self.sessions.lock().expect("mcp session lock poisoned");
            sessions
                .drain()
                .map(|(_, managed)| managed)
                .collect::<Vec<_>>()
        };

        for managed in sessions {
            let _ = managed.session.lock().await.close().await?;
        }

        Ok(())
    }

    async fn ensure_connected(
        &self,
        server: DesktopMcpServerConfig,
    ) -> Result<ManagedSession, DesktopMcpManagerError> {
        let name = server.name.trim().to_owned();
        if name.is_empty() {
            return Err(DesktopMcpManagerError::MissingName);
        }
        if !server.enabled {
            return Err(DesktopMcpManagerError::Disabled(name));
        }

        let spec = parse_endpoint_spec(&server.endpoint)?;
        if spec.kind == DesktopMcpEndpointKind::Stdio && !allow_local_process_mcp() {
            return Err(DesktopMcpManagerError::LocalProcessMcpDisabled);
        }
        let key = normalize_server_key(&name);
        {
            let sessions = self.sessions.lock().expect("mcp session lock poisoned");
            if let Some(existing) = sessions.get(&key) {
                if session_config_matches(&existing.server, &existing.spec, &server, &spec) {
                    return Ok(clone_managed_session(existing));
                }
            }
        }

        let _connect_guard = self.connect_lock.lock().await;
        let stale = {
            let mut sessions = self.sessions.lock().expect("mcp session lock poisoned");
            if let Some(existing) = sessions.get(&key) {
                if session_config_matches(&existing.server, &existing.spec, &server, &spec) {
                    return Ok(clone_managed_session(existing));
                }
            }
            sessions.remove(&key)
        };

        if let Some(stale) = stale {
            let _ = stale.session.lock().await.close().await;
        }

        let session = timeout(MCP_CONNECT_TIMEOUT, connect_spec(&spec))
            .await
            .map_err(|_| DesktopMcpManagerError::OperationTimeout {
                server: name.clone(),
                operation: "connect",
            })?
            .map_err(|source| DesktopMcpManagerError::Connect {
                server: name.clone(),
                source: Box::new(source),
            })?;

        let managed = ManagedSession {
            server: DesktopMcpServerConfig {
                name,
                endpoint: server.endpoint,
                enabled: server.enabled,
            },
            spec,
            session: Arc::new(AsyncMutex::new(session)),
        };

        let cloned = clone_managed_session(&managed);
        let mut sessions = self.sessions.lock().expect("mcp session lock poisoned");
        sessions.insert(key, managed);
        Ok(cloned)
    }
}

fn allow_local_process_mcp() -> bool {
    matches!(
        std::env::var(ALLOW_LOCAL_PROCESS_MCP_ENV),
        Ok(value) if value == "1" || value.eq_ignore_ascii_case("true")
    )
}

pub fn parse_endpoint_spec(
    raw: impl Into<String>,
) -> Result<DesktopMcpEndpointSpec, DesktopMcpManagerError> {
    let raw = raw.into();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(DesktopMcpManagerError::MissingEndpoint);
    }

    if let Some(command_line) = trimmed.strip_prefix("stdio:") {
        if let Some(url_command) = trimmed.strip_prefix("stdio://") {
            return parse_stdio_url(trimmed, url_command);
        }
        return parse_command_spec(trimmed, command_line);
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(DesktopMcpEndpointSpec {
            kind: DesktopMcpEndpointKind::StreamableHttp,
            raw: trimmed.to_owned(),
            url: Some(trimmed.to_owned()),
            command: None,
            args: Vec::new(),
        });
    }

    if is_windows_absolute_path(trimmed) {
        return parse_command_spec(trimmed, trimmed);
    }

    if let Some((scheme, _)) = trimmed.split_once(':') {
        if scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '-')
        {
            return Err(DesktopMcpManagerError::UnsupportedScheme(scheme.to_owned()));
        }
    }

    parse_command_spec(trimmed, trimmed)
}

pub async fn connect_streamable_http(
    endpoint: impl Into<String>,
) -> Result<DesktopMcpSession, ClientInitializeError> {
    let transport = StreamableHttpClientTransport::from_uri(endpoint.into());
    DesktopMcpClientHandler::default().serve(transport).await
}

pub async fn connect_stdio(command: Command) -> Result<DesktopMcpSession, DesktopMcpConnectError> {
    let transport = TokioChildProcess::new(command)?;
    let session = DesktopMcpClientHandler::default()
        .serve(transport)
        .await
        .map_err(|source| DesktopMcpConnectError::Initialize(Box::new(source)))?;
    Ok(session)
}

async fn connect_spec(
    spec: &DesktopMcpEndpointSpec,
) -> Result<DesktopMcpSession, DesktopMcpConnectError> {
    match spec.kind {
        DesktopMcpEndpointKind::StreamableHttp => {
            connect_streamable_http(spec.url.clone().expect("url missing for http endpoint"))
                .await
                .map_err(|source| DesktopMcpConnectError::Initialize(Box::new(source)))
        }
        DesktopMcpEndpointKind::Stdio => {
            let mut command = Command::new(
                spec.command
                    .clone()
                    .expect("command missing for stdio endpoint"),
            );
            command.args(spec.args.clone());
            connect_stdio(command).await
        }
    }
}

fn parse_stdio_url(
    raw: &str,
    url_command: &str,
) -> Result<DesktopMcpEndpointSpec, DesktopMcpManagerError> {
    let mut parts = url_command.split('?');
    let command = parts.next().unwrap_or_default().trim();
    if command.is_empty() {
        return Err(DesktopMcpManagerError::MissingCommand);
    }

    let args = parts
        .next()
        .map(|query| {
            query
                .split('&')
                .filter_map(|part| part.strip_prefix("arg="))
                .map(percent_decode)
                .filter(|arg| !arg.trim().is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(DesktopMcpEndpointSpec {
        kind: DesktopMcpEndpointKind::Stdio,
        raw: raw.to_owned(),
        url: None,
        command: Some(command.to_owned()),
        args,
    })
}

fn parse_command_spec(
    raw: &str,
    command_line: &str,
) -> Result<DesktopMcpEndpointSpec, DesktopMcpManagerError> {
    let parts = split_command_line(command_line)?;
    if parts.is_empty() {
        return Err(DesktopMcpManagerError::MissingCommand);
    }

    Ok(DesktopMcpEndpointSpec {
        kind: DesktopMcpEndpointKind::Stdio,
        raw: raw.to_owned(),
        url: None,
        command: Some(parts[0].clone()),
        args: parts[1..].to_vec(),
    })
}

fn is_windows_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && (bytes[0] as char).is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

fn split_command_line(input: &str) -> Result<Vec<String>, DesktopMcpManagerError> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.trim().chars().peekable();

    let flush = |parts: &mut Vec<String>, current: &mut String| {
        if current.is_empty() {
            return;
        }
        parts.push(current.clone());
        current.clear();
    };

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.peek().copied() {
                Some(next)
                    if next.is_whitespace() || next == '"' || next == '\'' || next == '\\' =>
                {
                    chars.next();
                    current.push(next);
                }
                Some(_) => current.push(ch),
                None => return Err(DesktopMcpManagerError::UnterminatedEscape),
            }
            continue;
        }

        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }

        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            continue;
        }

        if ch.is_whitespace() {
            flush(&mut parts, &mut current);
            continue;
        }

        current.push(ch);
    }

    if quote.is_some() {
        return Err(DesktopMcpManagerError::UnterminatedQuote);
    }

    flush(&mut parts, &mut current);
    Ok(parts)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                if let Some(parsed) = decode_percent_byte(bytes[index + 1], bytes[index + 2]) {
                    decoded.push(parsed);
                    index += 3;
                } else {
                    decoded.push(bytes[index]);
                    index += 1;
                }
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_percent_byte(high: u8, low: u8) -> Option<u8> {
    Some(hex_value(high)? << 4 | hex_value(low)?)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

async fn list_bounded_tools(
    session: &DesktopMcpSession,
    server: &str,
) -> Result<Vec<Tool>, DesktopMcpManagerError> {
    let mut tools = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_tools(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(|source| DesktopMcpManagerError::ListTools {
                server: server.to_string(),
                source,
            })?;
        tools.extend(result.tools);
        pagination.check_items(server, tools.len())?;
        if pagination.advance(server, result.next_cursor)? {
            continue;
        }
        return Ok(tools);
    }
}

async fn list_bounded_prompts(
    session: &DesktopMcpSession,
    server: &str,
) -> Result<Vec<Prompt>, DesktopMcpManagerError> {
    let mut prompts = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_prompts(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(|source| DesktopMcpManagerError::ListPrompts {
                server: server.to_string(),
                source,
            })?;
        prompts.extend(result.prompts);
        pagination.check_items(server, prompts.len())?;
        if pagination.advance(server, result.next_cursor)? {
            continue;
        }
        return Ok(prompts);
    }
}

async fn list_bounded_resources(
    session: &DesktopMcpSession,
    server: &str,
) -> Result<Vec<Resource>, DesktopMcpManagerError> {
    let mut resources = Vec::new();
    let mut pagination = DiscoveryPagination::default();
    loop {
        let result = session
            .peer()
            .list_resources(Some(
                PaginatedRequestParams::default().with_cursor(pagination.cursor.take()),
            ))
            .await
            .map_err(|source| DesktopMcpManagerError::ListResources {
                server: server.to_string(),
                source,
            })?;
        resources.extend(result.resources);
        pagination.check_items(server, resources.len())?;
        if pagination.advance(server, result.next_cursor)? {
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
    fn check_items(&self, server: &str, item_count: usize) -> Result<(), DesktopMcpManagerError> {
        if item_count > MAX_MCP_DISCOVERY_ITEMS {
            return Err(DesktopMcpManagerError::Pagination {
                server: server.to_string(),
                reason: format!("item count exceeded {MAX_MCP_DISCOVERY_ITEMS}"),
            });
        }
        Ok(())
    }

    fn advance(
        &mut self,
        server: &str,
        next_cursor: Option<String>,
    ) -> Result<bool, DesktopMcpManagerError> {
        self.pages += 1;
        let Some(next_cursor) = next_cursor.map(|cursor| cursor.trim().to_string()) else {
            return Ok(false);
        };
        if next_cursor.is_empty() {
            return Err(DesktopMcpManagerError::Pagination {
                server: server.to_string(),
                reason: "pagination cursor did not advance".to_string(),
            });
        }
        if self.pages >= MAX_MCP_DISCOVERY_PAGES {
            return Err(DesktopMcpManagerError::Pagination {
                server: server.to_string(),
                reason: format!("page count exceeded {MAX_MCP_DISCOVERY_PAGES}"),
            });
        }
        if !self.seen_cursors.insert(next_cursor.clone()) {
            return Err(DesktopMcpManagerError::Pagination {
                server: server.to_string(),
                reason: "pagination cursor repeated".to_string(),
            });
        }
        self.cursor = Some(next_cursor);
        Ok(true)
    }
}

fn normalize_server_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn trim_value(value: &str) -> String {
    value.trim().to_owned()
}

fn trim_option(value: Option<&str>) -> String {
    value.map(trim_value).unwrap_or_default()
}

fn session_config_matches(
    existing_server: &DesktopMcpServerConfig,
    existing_spec: &DesktopMcpEndpointSpec,
    server: &DesktopMcpServerConfig,
    spec: &DesktopMcpEndpointSpec,
) -> bool {
    existing_server.enabled == server.enabled
        && existing_server.endpoint == server.endpoint
        && *existing_spec == *spec
}

fn clone_managed_session(existing: &ManagedSession) -> ManagedSession {
    ManagedSession {
        server: existing.server.clone(),
        spec: existing.spec.clone(),
        session: Arc::clone(&existing.session),
    }
}

#[cfg(test)]
mod tests;
