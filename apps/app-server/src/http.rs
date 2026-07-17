use std::collections::{BTreeMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, Notify, Semaphore};

use crate::interactions::InteractionBroker;
use crate::protocol::{
    AppServerEvent, JsonRpcError, JsonRpcRequest, JsonRpcResponse, OutgoingMessage, ServerInfo,
    JSONRPC_VERSION,
};
use crate::remote_relay::{
    mobile_rpc_method_allowed, mobile_rpc_workspace_request_allowed, prepare_remote_poll,
    process_remote_poll_completion, report_remote_poll_result, REMOTE_POLL_CHECK_INTERVAL,
};
#[cfg(test)]
use crate::remote_relay::{
    remote_command_response, remote_interaction_response, split_remote_messages,
    RemotePollCompletion, RemotePollRequest,
};
use crate::runtime::{AppRuntime, RuntimeConfig, RuntimeError};
use crate::stdio;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_HTTP_CONNECTIONS: usize = 128;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(15);
const EVENT_BACKLOG_CAPACITY: usize = 256;
const ACCEPT_ERROR_BACKOFF: Duration = Duration::from_millis(100);

#[derive(Debug, Clone)]
pub struct HttpServerConfig {
    pub host: IpAddr,
    pub port: u16,
    pub pairing_code: Option<String>,
    pub allow_non_loopback: bool,
    pub advertise_host: Option<IpAddr>,
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 7319,
            pairing_code: None,
            allow_non_loopback: false,
            advertise_host: None,
        }
    }
}

#[derive(Debug, Error)]
pub enum HttpServerError {
    #[error("http pairing transport must bind to a loopback address")]
    NonLoopbackHost,
    #[error("bind http transport: {0}")]
    Bind(std::io::Error),
    #[error("accept http transport: {0}")]
    Accept(std::io::Error),
    #[error("runtime: {0}")]
    Runtime(#[from] RuntimeError),
}

#[derive(Debug)]
struct HttpServerState {
    runtime_commands: mpsc::Sender<HttpRuntimeCommand>,
    interaction_broker: InteractionBroker,
    server_info: ServerInfo,
    pairing_code: Mutex<Option<String>>,
    session_token: String,
    mobile_session_tokens: Mutex<Vec<String>>,
    mobile_push_tokens: Mutex<BTreeMap<String, String>>,
    connections: Mutex<BTreeMap<String, Arc<Mutex<stdio::ConnectionState>>>>,
    events: broadcast::Sender<SequencedHttpEvent>,
    event_backlog: Mutex<VecDeque<OutgoingMessage>>,
    connection_slots: Arc<Semaphore>,
    stats: HttpTransportStats,
    shutdown: Notify,
}

#[derive(Debug, Clone)]
struct SequencedHttpEvent {
    id: u64,
    message: OutgoingMessage,
}

#[derive(Debug, Default)]
struct HttpTransportStats {
    request_total: AtomicU64,
    auth_failed: AtomicU64,
    pairing_success: AtomicU64,
    pairing_failed: AtomicU64,
    rpc_total: AtomicU64,
    rpc_failed: AtomicU64,
    event_stream_total: AtomicU64,
    events_published: AtomicU64,
    event_backlog_dropped: AtomicU64,
}

impl HttpTransportStats {
    fn increment(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }

    fn snapshot(&self) -> Value {
        json!({
            "requestTotal": self.request_total.load(Ordering::Relaxed),
            "authFailed": self.auth_failed.load(Ordering::Relaxed),
            "pairingSuccess": self.pairing_success.load(Ordering::Relaxed),
            "pairingFailed": self.pairing_failed.load(Ordering::Relaxed),
            "rpcTotal": self.rpc_total.load(Ordering::Relaxed),
            "rpcFailed": self.rpc_failed.load(Ordering::Relaxed),
            "eventStreamTotal": self.event_stream_total.load(Ordering::Relaxed),
            "eventsPublished": self.events_published.load(Ordering::Relaxed),
            "eventBacklogDropped": self.event_backlog_dropped.load(Ordering::Relaxed),
        })
    }
}

enum HttpRuntimeCommand {
    Rpc {
        session_id: String,
        request: JsonRpcRequest,
        mobile: bool,
        respond_to: oneshot::Sender<HttpRuntimeResponse>,
    },
    MobileWorkspaceRoots {
        respond_to: oneshot::Sender<Result<Vec<PathBuf>, RuntimeError>>,
    },
}

async fn mobile_workspace_roots(state: &HttpServerState) -> Result<Vec<PathBuf>, RuntimeError> {
    let (respond_to, response_rx) = oneshot::channel();
    state
        .runtime_commands
        .send(HttpRuntimeCommand::MobileWorkspaceRoots { respond_to })
        .await
        .map_err(|_| RuntimeError::storage("runtime unavailable"))?;
    response_rx
        .await
        .map_err(|_| RuntimeError::storage("runtime unavailable"))?
}

fn runtime_mobile_workspace_roots(runtime: &AppRuntime) -> Result<Vec<PathBuf>, RuntimeError> {
    let workspaces = runtime
        .metadata_json::<BTreeMap<i64, Vec<String>>>(
            crate::runtime::PROJECT_WORKSPACES_METADATA_KEY,
        )?
        .unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut roots = Vec::new();
    for workspace in workspaces.into_values().flatten() {
        let Ok(canonical) = PathBuf::from(workspace).canonicalize() else {
            continue;
        };
        let Ok(canonical) = taskforceai_core::local_coding::validate_workspace_path(
            canonical.clone(),
            canonical.is_dir(),
            home.as_deref(),
        ) else {
            continue;
        };
        if !roots.contains(&canonical) {
            roots.push(canonical);
        }
    }
    Ok(roots)
}

#[derive(Debug)]
struct HttpRuntimeResponse {
    response: Option<JsonRpcResponse>,
    action: stdio::ServerAction,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

pub async fn run_http(config: HttpServerConfig) -> Result<(), HttpServerError> {
    crate::tls::install_default_crypto_provider();
    validate_bind_host(&config)?;
    let listener = TcpListener::bind(SocketAddr::new(config.host, config.port))
        .await
        .map_err(HttpServerError::Bind)?;
    let mut runtime = AppRuntime::try_new(RuntimeConfig::from_env())?;
    let server_info = runtime.config.server_info.clone();
    let (runtime_event_tx, runtime_event_rx) = mpsc::channel(128);
    runtime.set_event_sender(runtime_event_tx);
    let resumed_runs = runtime.resume_remote_run_streams();
    if resumed_runs > 0 {
        // coverage:ignore-start
        log::info!(
            target: "taskforceai_app_server",
        // coverage:ignore-end
            "resumed {resumed_runs} remote run stream(s)"
        );
    }
    let (events, _) = broadcast::channel(128);
    let (runtime_commands, runtime_command_rx) = mpsc::channel(512);
    let (runtime_outputs, runtime_output_rx) = mpsc::unbounded_channel();
    let (interaction_output_tx, mut interaction_output_rx) = mpsc::channel(256);
    let interaction_broker = InteractionBroker::new(interaction_output_tx);
    runtime.set_interaction_broker(interaction_broker.clone());
    let pairing_code = config.pairing_code.unwrap_or_else(generate_token);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        interaction_broker,
        server_info,
        pairing_code: Mutex::new(Some(pairing_code.clone())),
        session_token: generate_token(),
        mobile_session_tokens: Mutex::new(Vec::new()),
        mobile_push_tokens: Mutex::new(BTreeMap::new()),
        connections: Mutex::new(BTreeMap::new()),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        connection_slots: Arc::new(Semaphore::new(MAX_HTTP_CONNECTIONS)),
        stats: HttpTransportStats::default(),
        shutdown: Notify::new(),
    });
    tokio::spawn(http_runtime_loop(
        runtime,
        runtime_command_rx,
        runtime_event_rx,
        runtime_outputs.clone(),
        Arc::clone(&state),
    ));
    let interaction_outputs = runtime_outputs.clone();
    tokio::spawn(async move {
        while let Some(message) = interaction_output_rx.recv().await {
            // coverage:ignore-start -- requires the HTTP output loop to terminate between receiving and forwarding an interaction.
            if interaction_outputs.send(vec![message]).is_err() {
                break;
            }
            // coverage:ignore-end
        }
    });
    tokio::spawn(http_runtime_output_loop(
        Arc::clone(&state),
        runtime_output_rx,
    ));
    let local_addr = listener.local_addr().map_err(HttpServerError::Bind)?;
    write_startup_log(local_addr, config.advertise_host);
    serve_listener(listener, state).await
}

fn validate_bind_host(config: &HttpServerConfig) -> Result<(), HttpServerError> {
    if config.host.is_loopback() || config.allow_non_loopback {
        Ok(())
    } else {
        Err(HttpServerError::NonLoopbackHost)
    }
}

async fn serve_listener(
    listener: TcpListener,
    state: Arc<HttpServerState>,
) -> Result<(), HttpServerError> {
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let Ok(connection_slot) = Arc::clone(&state.connection_slots).try_acquire_owned() else {
                            // coverage:ignore-start -- Defensive overload shedding requires racing the private listener semaphore.
                            log::warn!(target: "http", "HTTP app-server connection limit reached");
                            continue;
                            // coverage:ignore-end
                        };
                        let state = Arc::clone(&state);
                        tokio::spawn(async move { // coverage:ignore-line
                            let _connection_slot = connection_slot;
                            if let Err(error) = handle_connection(stream, state).await {
                                log::warn!(target: "http", "HTTP app-server connection failed: {error}"); // coverage:ignore-line
                            }
                        });
                    }
                    Err(error) => { // coverage:ignore-line
                        // coverage:ignore-start
                        log::warn!(target: "http", "HTTP app-server accept failed: {error}");
                        tokio::time::sleep(ACCEPT_ERROR_BACKOFF).await;
                        // coverage:ignore-end
                    }
                }
            }
            () = state.shutdown.notified() => break,
        }
    }
    Ok(())
}

async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<HttpServerState>,
) -> Result<(), std::io::Error> {
    let request = match read_request(&mut stream).await {
        // coverage:ignore-line
        Ok(request) => request, // coverage:ignore-line
        // coverage:ignore-start
        Err(response) => {
            stream.write_all(&response).await?;
            return Ok(());
            // coverage:ignore-end
        } // coverage:ignore-line
    };
    if request.method == "GET" && request.path == "/events" {
        // coverage:ignore-start
        handle_event_stream(stream, request, state).await?;
        return Ok(());
        // coverage:ignore-end
    }
    let response = route_request(request, state).await;
    stream.write_all(&response).await?;
    Ok(())
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, Vec<u8>> {
    read_request_with_timeout(stream, REQUEST_READ_TIMEOUT).await
}

async fn read_request_with_timeout(
    stream: &mut TcpStream,
    timeout: Duration,
) -> Result<HttpRequest, Vec<u8>> {
    tokio::time::timeout(timeout, read_request_inner(stream))
        .await
        .unwrap_or_else(|_| Err(response(408, json!({"error": "request timeout"}))))
}

async fn read_request_inner(stream: &mut TcpStream) -> Result<HttpRequest, Vec<u8>> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| response(400, json!({"error": "bad request"})))?;
        if read == 0 {
            return Err(response(400, json!({"error": "bad request"})));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err(response(413, json!({"error": "request too large"})));
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let headers_raw = String::from_utf8(buffer[..header_end].to_vec())
        .map_err(|_| response(400, json!({"error": "bad request"})))?;
    let mut lines = headers_raw.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| response(400, json!({"error": "bad request"})))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| response(400, json!({"error": "bad request"})))?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| response(400, json!({"error": "bad request"})))?
        .to_string();
    let mut headers = BTreeMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_REQUEST_BYTES {
        return Err(response(413, json!({"error": "request too large"})));
    }

    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let read = stream // coverage:ignore-line
            .read(&mut chunk) // coverage:ignore-line
            .await // coverage:ignore-line
            .map_err(|_| response(400, json!({"error": "bad request"})))?; // coverage:ignore-line
        if read == 0 {
            // coverage:ignore-line
            return Err(response(400, json!({"error": "bad request"})));
            // coverage:ignore-start
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_REQUEST_BYTES {
            return Err(response(413, json!({"error": "request too large"})));
        }
        // coverage:ignore-end
    }
    let body = buffer[body_start..body_start + content_length].to_vec();
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

async fn route_request(request: HttpRequest, state: Arc<HttpServerState>) -> Vec<u8> {
    HttpTransportStats::increment(&state.stats.request_total);
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => response_for_request(204, Value::Null, &request),
        ("GET", "/health") => response_for_request(
            200,
            json!({
                "ok": true,
                "server": state.server_info.clone(),
                "transport": {"kind": "http", "encoding": "json"},
                "observability": state.stats.snapshot(),
            }),
            &request,
        ),
        ("GET", "/schema") => response_for_request(
            200,
            serde_json::from_str(crate::protocol_schema()).unwrap_or(Value::Null),
            &request,
        ),
        ("GET", "/pairing") => {
            let Some(code) = request.headers.get("x-taskforce-pairing-code") else {
                HttpTransportStats::increment(&state.stats.pairing_failed);
                return response_for_request(
                    401,
                    json!({"error": "pairing code required"}),
                    &request,
                );
            };
            let mut pairing_code = state.pairing_code.lock().await;
            if !pairing_code
                .as_deref()
                .is_some_and(|value| constant_time_eq(value, code))
            {
                HttpTransportStats::increment(&state.stats.pairing_failed);
                return response_for_request(
                    403,
                    json!({"error": "invalid pairing code"}),
                    &request,
                );
            }
            let mobile_client = request
                .headers
                .get("x-taskforce-client")
                .is_some_and(|value| value.eq_ignore_ascii_case("mobile"));
            let session_token = if mobile_client {
                let workspace_roots = match mobile_workspace_roots(&state).await {
                    Ok(workspace_roots) => workspace_roots,
                    Err(error) => {
                        HttpTransportStats::increment(&state.stats.pairing_failed);
                        return response_for_request(
                            500,
                            json!({"error": format!("mobile workspace authorization unavailable: {error}")}),
                            &request,
                        );
                    }
                };
                let token = generate_token();
                state.mobile_session_tokens.lock().await.push(token.clone());
                state.connections.lock().await.insert(
                    token.clone(),
                    Arc::new(Mutex::new(stdio::ConnectionState::authenticated_mobile(
                        workspace_roots,
                    ))),
                );
                token
            } else {
                state.session_token.clone()
            };
            *pairing_code = None;
            HttpTransportStats::increment(&state.stats.pairing_success);
            response_for_request(
                200,
                json!({
                    "sessionToken": session_token,
                    "sessionScope": if mobile_client { "mobile-control" } else { "desktop-local" },
                    "transport": {"kind": "http", "encoding": "json"},
                    "rpcPath": "/rpc",
                    "eventsPath": "/events",
                }),
                &request,
            )
        }
        ("POST", "/pairing-code") => {
            if !authorized(&request, &state.session_token) {
                HttpTransportStats::increment(&state.stats.auth_failed);
                HttpTransportStats::increment(&state.stats.pairing_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            }
            let next_code = generate_token();
            let mut pairing_code = state.pairing_code.lock().await;
            *pairing_code = Some(next_code.clone());
            HttpTransportStats::increment(&state.stats.pairing_success);
            response_for_request(
                200,
                json!({
                    "pairingCode": next_code,
                    "transport": {"kind": "http", "encoding": "json"},
                    "rpcPath": "/rpc",
                    "eventsPath": "/events",
                }),
                &request,
            )
        }
        ("DELETE", "/session") => {
            let Some(access) = session_access(&request, &state).await else {
                HttpTransportStats::increment(&state.stats.auth_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            if access != HttpSessionAccess::Mobile {
                return response_for_request(
                    403,
                    json!({"error": "desktop-local session cannot be revoked here"}),
                    &request,
                );
            }
            // coverage:ignore-start -- Mobile access is established from this same required session token above.
            let Some(token) = request_session_token(&request) else {
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            // coverage:ignore-end
            state
                .mobile_session_tokens
                .lock()
                .await
                .retain(|candidate| !constant_time_eq(candidate, token));
            state.mobile_push_tokens.lock().await.remove(token);
            state.connections.lock().await.remove(token);
            response_for_request(204, Value::Null, &request)
        }
        ("POST", "/mobile-notifications") => {
            let Some(access) = session_access(&request, &state).await else {
                HttpTransportStats::increment(&state.stats.auth_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            if access != HttpSessionAccess::Mobile {
                return response_for_request(
                    403,
                    json!({"error": "mobile session required"}),
                    &request,
                );
            }
            // coverage:ignore-start -- Mobile access is established from this same required session token above.
            let Some(session_token) = request_session_token(&request) else {
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            // coverage:ignore-end
            let push_token = serde_json::from_slice::<Value>(&request.body)
                .ok()
                .and_then(|value| {
                    value
                        .get("expoPushToken")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            let Some(push_token) = push_token.filter(|token| valid_expo_push_token(token)) else {
                return response_for_request(
                    400,
                    json!({"error": "valid Expo push token required"}),
                    &request,
                );
            };
            state
                .mobile_push_tokens
                .lock()
                .await
                .insert(session_token.to_string(), push_token);
            response_for_request(200, json!({"ok": true}), &request)
        }
        ("DELETE", "/mobile-notifications") => {
            let Some(access) = session_access(&request, &state).await else {
                HttpTransportStats::increment(&state.stats.auth_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            if access != HttpSessionAccess::Mobile {
                return response_for_request(
                    403,
                    json!({"error": "mobile session required"}),
                    &request,
                );
            }
            if let Some(session_token) = request_session_token(&request) {
                state.mobile_push_tokens.lock().await.remove(session_token);
            }
            response_for_request(204, Value::Null, &request)
        }
        ("GET", "/events/snapshot") => {
            if session_access(&request, &state).await.is_none() {
                HttpTransportStats::increment(&state.stats.auth_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            }
            let session_id = request_session_token(&request)
                .expect("authorized HTTP request should include a session token");
            let connection = http_connection(&state, session_id).await;
            let connection = connection.lock().await;
            let after = request_event_cursor(&request);
            let backlog = state.event_backlog.lock().await;
            let cursor = state.stats.events_published.load(Ordering::Relaxed);
            let oldest_cursor = cursor.saturating_sub(backlog.len() as u64);
            let sequenced = backlog
                .iter()
                .enumerate()
                .map(|(index, message)| (oldest_cursor + index as u64 + 1, message))
                .filter(|(event_id, message)| {
                    after.is_none_or(|after| *event_id > after)
                        && message_allowed_for_connection(message, &connection)
                })
                .collect::<Vec<_>>();
            let event_ids = sequenced.iter().map(|(id, _)| *id).collect::<Vec<_>>();
            let events = sequenced
                .into_iter()
                .map(|(_, message)| message.clone())
                .collect::<VecDeque<_>>();
            response_for_request(
                200,
                json!({
                    "events": events,
                    "eventIds": event_ids,
                    "cursor": cursor,
                    "oldestCursor": oldest_cursor,
                    "replayTruncated": after.is_some_and(|after| after < oldest_cursor),
                }),
                &request,
            )
        }
        ("POST", "/rpc") => {
            let Some(access) = session_access(&request, &state).await else {
                HttpTransportStats::increment(&state.stats.auth_failed);
                HttpTransportStats::increment(&state.stats.rpc_failed);
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            };
            HttpTransportStats::increment(&state.stats.rpc_total);
            let raw = match serde_json::from_slice::<Value>(&request.body) {
                Ok(raw) => raw,
                Err(_) => {
                    HttpTransportStats::increment(&state.stats.rpc_failed);
                    return response_for_request(
                        200,
                        json_rpc_response(error_response(None, -32700, "Parse error")),
                        &request,
                    );
                }
            };
            if raw.get("method").is_none() && raw.get("id").is_some() {
                let response_message = match serde_json::from_value::<JsonRpcResponse>(raw) {
                    Ok(response) => response,
                    Err(_) => {
                        HttpTransportStats::increment(&state.stats.rpc_failed);
                        return response_for_request(
                            200,
                            json_rpc_response(error_response(None, -32600, "Invalid Request")),
                            &request,
                        );
                    }
                };
                if !state.interaction_broker.resolve(response_message).await {
                    HttpTransportStats::increment(&state.stats.rpc_failed);
                }
                return response_for_request(204, Value::Null, &request);
            }
            let rpc_request = match serde_json::from_value::<JsonRpcRequest>(raw) {
                Ok(request) => request,
                Err(_) => {
                    HttpTransportStats::increment(&state.stats.rpc_failed);
                    return response_for_request(
                        200,
                        json_rpc_response(error_response(None, -32700, "Parse error")),
                        &request,
                    );
                }
            };
            let session_id = request_session_token(&request)
                .expect("authorized HTTP request should include a session token")
                .to_string();
            if access == HttpSessionAccess::Mobile
                && !mobile_rpc_method_allowed(rpc_request.method.as_deref())
            {
                HttpTransportStats::increment(&state.stats.rpc_failed);
                return response_for_request(
                    200,
                    json_rpc_response(error_response(
                        rpc_request.response_id(),
                        -32601,
                        "Method is not available to mobile control sessions",
                    )),
                    &request,
                );
            }
            let (rpc_response, action) =
                handle_rpc_request(session_id, rpc_request, Arc::clone(&state)).await;
            if action == stdio::ServerAction::Shutdown {
                state.shutdown.notify_one();
            }
            match rpc_response {
                Some(rpc_response) => {
                    if rpc_response.error.is_some() {
                        HttpTransportStats::increment(&state.stats.rpc_failed);
                    }
                    response_for_request(200, json_rpc_response(rpc_response), &request)
                }
                None => response_for_request(204, Value::Null, &request),
            }
        }
        _ => response_for_request(404, json!({"error": "not found"}), &request),
    }
}

async fn handle_rpc_request(
    session_id: String,
    request: JsonRpcRequest,
    state: Arc<HttpServerState>,
) -> (Option<JsonRpcResponse>, stdio::ServerAction) {
    let id = request.response_id();
    let is_notification = request.is_notification();
    let (respond_to, response_rx) = oneshot::channel();
    let mobile = state
        .mobile_session_tokens
        .lock()
        .await
        .iter()
        .any(|token| constant_time_eq(token, &session_id));
    if state
        .runtime_commands
        .send(HttpRuntimeCommand::Rpc {
            session_id,
            request,
            mobile,
            respond_to,
        })
        .await
        .is_err()
    {
        return (
            (!is_notification).then(|| error_response(id.clone(), -32603, "Runtime unavailable")),
            stdio::ServerAction::Continue,
        );
    }

    match response_rx.await {
        Ok(response) => (response.response, response.action),
        Err(_) => (
            (!is_notification).then(|| error_response(id, -32603, "Runtime unavailable")),
            stdio::ServerAction::Continue,
        ),
    }
}

mod runtime_transport;
use runtime_transport::*;

#[path = "http_support.rs"]
mod http_support;
use http_support::*;

#[cfg(test)]
mod tests;
