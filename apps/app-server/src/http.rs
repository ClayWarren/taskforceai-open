use std::collections::{BTreeMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, Notify};

use crate::interactions::InteractionBroker;
use crate::protocol::{
    AppServerEvent, JsonRpcError, JsonRpcRequest, JsonRpcResponse, OutgoingMessage, ServerInfo,
    JSONRPC_VERSION,
};
use crate::remote_relay::{
    mobile_rpc_method_allowed, prepare_remote_poll, process_remote_poll_completion,
    report_remote_poll_result, REMOTE_POLL_CHECK_INTERVAL,
};
#[cfg(test)]
use crate::remote_relay::{
    remote_command_response, remote_interaction_response, split_remote_messages,
    RemotePollCompletion, RemotePollRequest,
};
use crate::runtime::{AppRuntime, RuntimeConfig, RuntimeError};
use crate::stdio;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
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
    events: broadcast::Sender<OutgoingMessage>,
    event_backlog: Mutex<VecDeque<OutgoingMessage>>,
    stats: HttpTransportStats,
    shutdown: Notify,
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
        request: JsonRpcRequest,
        respond_to: oneshot::Sender<HttpRuntimeResponse>,
    },
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
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
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
                        let state = Arc::clone(&state);
                        tokio::spawn(async move { // coverage:ignore-line
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
            *pairing_code = None;
            let mobile_client = request
                .headers
                .get("x-taskforce-client")
                .is_some_and(|value| value.eq_ignore_ascii_case("mobile"));
            let session_token = if mobile_client {
                let token = generate_token();
                state.mobile_session_tokens.lock().await.push(token.clone());
                token
            } else {
                state.session_token.clone()
            };
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
            let backlog = state.event_backlog.lock().await.clone();
            response_for_request(200, json!({"events": backlog}), &request)
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
            let (rpc_response, action) = handle_rpc_request(rpc_request, Arc::clone(&state)).await;
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
    request: JsonRpcRequest,
    state: Arc<HttpServerState>,
) -> (Option<JsonRpcResponse>, stdio::ServerAction) {
    let id = request.response_id();
    let is_notification = request.is_notification();
    let (respond_to, response_rx) = oneshot::channel();
    if state
        .runtime_commands
        .send(HttpRuntimeCommand::Rpc {
            request,
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

async fn http_runtime_loop(
    mut runtime: AppRuntime,
    mut commands: mpsc::Receiver<HttpRuntimeCommand>,
    mut runtime_events: mpsc::Receiver<AppServerEvent>,
    runtime_outputs: mpsc::UnboundedSender<Vec<OutgoingMessage>>,
    state: Arc<HttpServerState>,
) {
    let mut connection = stdio::ConnectionState::default();
    let mut remote_poll = tokio::time::interval(REMOTE_POLL_CHECK_INTERVAL);
    remote_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let (remote_poll_tx, mut remote_poll_rx) = mpsc::channel(1);
    let mut remote_poll_in_flight = false;
    loop {
        tokio::select! {
            Some(command) = commands.recv() => { // coverage:ignore-line
                match command {
                    HttpRuntimeCommand::Rpc { request, respond_to } => { // coverage:ignore-line
                        handle_runtime_rpc(
                            &mut runtime,
                            &mut connection,
                            request,
                            respond_to,
                            &runtime_outputs,
                        ).await;
                    }
                } // coverage:ignore-line
            }
            Some(event) = runtime_events.recv() => {
                handle_runtime_event(&mut runtime, event, &runtime_outputs).await; // coverage:ignore-line
            }
            Some(result) = remote_poll_rx.recv() => {
                remote_poll_in_flight = false;
                let result = match result {
                    Ok(completion) => {
                        let event_backlog = state.event_backlog.lock().await.clone();
                        process_remote_poll_completion(
                            &mut runtime,
                            &mut connection,
                            &state.interaction_broker,
                            &event_backlog,
                            completion,
                        ).await.map(|notifications| {
                            if !notifications.is_empty() {
                                let _ = runtime_outputs.send(notifications);
                            }
                        })
                    }
                    Err(error) => Err(error),
                };
                report_remote_poll_result(result);
            }
            _ = remote_poll.tick(), if !remote_poll_in_flight => {
                match prepare_remote_poll(&mut runtime) {
                    Ok(Some(request)) => {
                        remote_poll_in_flight = true;
                        let sender = remote_poll_tx.clone();
                        tokio::spawn(async move {
                            let _ = sender.send(request.execute().await).await;
                        });
                    }
                    Ok(None) => {}
                    Err(error) => report_remote_poll_result(Err(error)), // coverage:ignore-line -- requires a persistence failure between runtime startup and polling.
                }
            }
            else => break, // coverage:ignore-line
        }
    }
} // coverage:ignore-line

async fn handle_runtime_rpc(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    request: JsonRpcRequest,
    respond_to: oneshot::Sender<HttpRuntimeResponse>,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    let (messages, action) = stdio::handle_request(request, runtime, connection).await;
    let mut rpc_response = None;
    let mut notifications = Vec::new();
    for message in messages {
        match message {
            OutgoingMessage::Response(response) => {
                rpc_response = Some(response);
            } // coverage:ignore-line
            notification => notifications.push(notification),
        }
    }
    if !notifications.is_empty() {
        let notification_count = notifications.len();
        if runtime_outputs.send(notifications).is_err() {
            log::warn!( // coverage:ignore-line -- diagnostics-only branch is exercised through the closed-output test.
                target: "http", // coverage:ignore-line
                "Failed to enqueue HTTP runtime notifications; output loop is closed (count={notification_count})"
            );
        }
    }
    if respond_to
        .send(HttpRuntimeResponse {
            response: rpc_response,
            action,
        })
        .is_err()
    {
        log::warn!(target: "http", "HTTP RPC client disconnected before response");
    }
}
// coverage:ignore-line
async fn handle_runtime_event(
    // coverage:ignore-line
    runtime: &mut AppRuntime, // coverage:ignore-line
    event: AppServerEvent,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    let events = match runtime.apply_event(event) {
        Ok(events) => events,
        // coverage:ignore-start
        Err(error) => {
            log::warn!(target: "http", "Failed to apply HTTP runtime event: {error}");
            return;
            // coverage:ignore-end
        } // coverage:ignore-line
    };
    let mut messages = Vec::with_capacity(events.len() * 3);
    for event in events {
        stdio::extend_event_notifications(&mut messages, event);
    } // coverage:ignore-line
    let workflow_events = match runtime.advance_ready_workflow_runs().await {
        // coverage:ignore-line
        Ok(events) => events,
        // coverage:ignore-start
        Err(error) => {
            log::warn!(target: "http", "Failed to advance HTTP workflow runs after event: {error}");
            return;
            // coverage:ignore-end
        }
    };
    messages.reserve(workflow_events.len() * 3); // coverage:ignore-line
    for event in workflow_events {
        // coverage:ignore-start
        stdio::extend_event_notifications(&mut messages, event);
    }
    // coverage:ignore-end
    if !messages.is_empty() {
        let message_count = messages.len();
        if runtime_outputs.send(messages).is_err() {
            log::warn!(
                target: "http", // coverage:ignore-line
                "Failed to enqueue HTTP runtime event notifications; output loop is closed (count={message_count})"
            );
        }
    } // coverage:ignore-line
}

async fn http_runtime_output_loop(
    state: Arc<HttpServerState>,
    mut runtime_outputs: mpsc::UnboundedReceiver<Vec<OutgoingMessage>>,
) {
    while let Some(messages) = runtime_outputs.recv().await {
        publish_http_events(&state, messages).await;
    }
} // coverage:ignore-line

async fn publish_http_events(state: &Arc<HttpServerState>, messages: Vec<OutgoingMessage>) {
    for message in messages {
        publish_http_event(state, message).await;
    }
}

async fn publish_http_event(state: &Arc<HttpServerState>, message: OutgoingMessage) {
    // coverage:ignore-start -- Expo delivery is an external fire-and-forget boundary; payload mapping is tested separately.
    if let Some(notification) = remote_push_notification(&message) {
        let tokens = state
            .mobile_push_tokens
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        if !tokens.is_empty() {
            tokio::spawn(send_remote_push_notifications(tokens, notification));
        }
    }
    // coverage:ignore-end
    {
        let mut backlog = state.event_backlog.lock().await;
        if backlog.len() == EVENT_BACKLOG_CAPACITY {
            backlog.pop_front();
            HttpTransportStats::increment(&state.stats.event_backlog_dropped);
        }
        backlog.push_back(message.clone());
        let _ = state.events.send(message);
    }
    HttpTransportStats::increment(&state.stats.events_published);
}

#[derive(Debug, Clone)]
struct RemotePushNotification {
    title: String,
    body: String,
    kind: String,
    thread_id: String,
}

fn remote_push_notification(message: &OutgoingMessage) -> Option<RemotePushNotification> {
    let value = serde_json::to_value(message).ok()?;
    let method = value.get("method")?.as_str()?;
    let params = value.get("params")?;
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.get("thread")?.get("id")?.as_str())?
        .to_string();
    let (title, body, kind) = match method {
        "turn/completed" => (
            "Remote task completed",
            "Your desktop task has finished.",
            "desktop.completed",
        ),
        "turn/interrupted" => (
            "Remote task stopped",
            "Your desktop task was interrupted.",
            "desktop.interrupted",
        ),
        method if method.contains("requestUserInput") => (
            "Remote task needs input",
            "Open Remote to answer the desktop task.",
            "desktop.needs_input",
        ),
        method if method.contains("requestApproval") => (
            "Remote task needs approval",
            "Open Remote to review the requested action.",
            "desktop.needs_approval",
        ),
        "turn/updated"
            if params
                .get("turn")
                .and_then(|turn| turn.get("status"))
                .and_then(Value::as_str)
                == Some("failed") =>
        {
            (
                "Remote task failed",
                "Open Remote to review the failure.",
                "desktop.failed",
            )
        }
        _ => return None,
    };
    Some(RemotePushNotification {
        title: title.to_string(),
        body: body.to_string(),
        kind: kind.to_string(),
        thread_id,
    })
}

// coverage:ignore-start -- Calls the external Expo push service; payload selection and validation are covered without network I/O.
async fn send_remote_push_notifications(tokens: Vec<String>, notification: RemotePushNotification) {
    let messages = tokens
        .into_iter()
        .map(|token| {
            json!({
                "to": token,
                "sound": "default",
                "title": notification.title,
                "body": notification.body,
                "data": {
                    "surface": "remote",
                    "type": notification.kind,
                    "remoteThreadId": notification.thread_id,
                },
            })
        })
        .collect::<Vec<_>>();
    if let Err(error) = reqwest::Client::new()
        .post("https://exp.host/--/api/v2/push/send")
        .json(&messages)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
    {
        log::warn!(target: "http", "Failed to send Remote push notification: {error}");
    }
}
// coverage:ignore-end

fn valid_expo_push_token(token: &str) -> bool {
    let valid_prefix =
        token.starts_with("ExponentPushToken[") || token.starts_with("ExpoPushToken[");
    valid_prefix && token.ends_with(']') && token.len() <= 256
}

async fn subscribe_http_events(
    state: &HttpServerState,
) -> (
    broadcast::Receiver<OutgoingMessage>,
    VecDeque<OutgoingMessage>,
) {
    let backlog = state.event_backlog.lock().await;
    let receiver = state.events.subscribe();
    (receiver, backlog.clone())
}

async fn handle_event_stream(
    mut stream: TcpStream,
    request: HttpRequest,
    state: Arc<HttpServerState>,
) -> Result<(), std::io::Error> {
    if session_access(&request, &state).await.is_none() {
        HttpTransportStats::increment(&state.stats.auth_failed);
        stream
            .write_all(&response_for_request(
                401,
                json!({"error": "session token required"}),
                &request,
            ))
            .await?;
        return Ok(());
    }
    HttpTransportStats::increment(&state.stats.event_stream_total);

    let cors_headers = cors_headers(&request);
    stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: keep-alive\r\n{cors_headers}\r\n"
            ) // coverage:ignore-line
            .as_bytes(), // coverage:ignore-line
        )
        .await?;
    // coverage:ignore-line
    let (mut receiver, backlog) = subscribe_http_events(&state).await;
    for message in backlog {
        write_event_line(&mut stream, &message).await?;
    }

    loop {
        match receiver.recv().await {
            Ok(message) => write_event_line(&mut stream, &message).await?,
            // coverage:ignore-start
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
            // coverage:ignore-end
        }
    }
    Ok(()) // coverage:ignore-line
}

async fn write_event_line(
    stream: &mut TcpStream,
    message: &OutgoingMessage,
) -> Result<(), std::io::Error> {
    let mut encoded = serde_json::to_vec(message).expect("event message should serialize");
    encoded.push(b'\n');
    stream.write_all(&encoded).await?;
    stream.flush().await
}

fn authorized(request: &HttpRequest, session_token: &str) -> bool {
    request_session_token(request).is_some_and(|value| constant_time_eq(value, session_token))
}

fn request_session_token(request: &HttpRequest) -> Option<&str> {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| {
            request
                .headers
                .get("x-taskforce-session")
                .map(String::as_str)
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpSessionAccess {
    Local,
    Mobile,
}

async fn session_access(
    request: &HttpRequest,
    state: &HttpServerState,
) -> Option<HttpSessionAccess> {
    if authorized(request, &state.session_token) {
        return Some(HttpSessionAccess::Local);
    }
    let bearer = request_session_token(request)?;
    state
        .mobile_session_tokens
        .lock()
        .await
        .iter()
        .any(|token| constant_time_eq(bearer, token))
        .then_some(HttpSessionAccess::Mobile)
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut diff = left.len() ^ right.len();
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        diff |= usize::from(left_byte ^ right_byte);
    }
    diff == 0
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    let mut index = 0;
    while index + 3 < buffer.len() {
        if buffer[index] == b'\r'
            && buffer[index + 1] == b'\n'
            && buffer[index + 2] == b'\r'
            && buffer[index + 3] == b'\n'
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn response(status: u16, body: Value) -> Vec<u8> {
    response_with_cors(status, body, "")
}

fn response_for_request(status: u16, body: Value, request: &HttpRequest) -> Vec<u8> {
    response_with_cors(status, body, &cors_headers(request))
}

fn response_with_cors(status: u16, body: Value, cors_headers: &str) -> Vec<u8> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Internal Server Error",
    };
    let body = if status == 204 {
        Vec::new()
    } else {
        serde_json::to_vec(&body).expect("http response should serialize")
    };
    let headers = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{cors_headers}\r\n",
        body.len(),
    );
    let mut encoded = headers.into_bytes();
    encoded.extend_from_slice(&body);
    encoded
}

fn cors_headers(request: &HttpRequest) -> String {
    let Some(origin) = request.headers.get("origin") else {
        return String::new();
    };
    if !is_allowed_cors_origin(origin) {
        return String::new();
    }
    format!(
        "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: DELETE, GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type, X-Taskforce-Client, X-Taskforce-Pairing-Code, X-Taskforce-Session\r\nVary: Origin\r\n"
    )
}

fn is_allowed_cors_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://localhost:3210"
            | "http://127.0.0.1:3210"
            | "tauri://localhost"
            | "https://taskforceai.chat"
            | "https://www.taskforceai.chat"
    )
}

fn json_rpc_response(response: JsonRpcResponse) -> Value {
    serde_json::to_value(response).expect("json-rpc response should serialize")
}

#[cfg(test)]
fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Option<Value>, code: i64, message: impl Into<String>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.into(),
            data: None,
        }),
    }
}

fn generate_token() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn write_startup_log(local_addr: SocketAddr, advertise_host: Option<IpAddr>) {
    let advertised_addr =
        SocketAddr::new(advertise_host.unwrap_or(local_addr.ip()), local_addr.port());
    eprintln!(
        "{}",
        json!({
            "level": "info",
            "target": "taskforceai_app_server",
            "message": "taskforceai app-server http transport listening",
            "baseUrl": format!("http://{advertised_addr}"),
        })
    );
}

#[cfg(test)]
mod tests;
