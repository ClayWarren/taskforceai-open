use std::collections::{BTreeMap, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex, Notify};

use crate::protocol::{
    AppServerEvent, JsonRpcError, JsonRpcRequest, JsonRpcResponse, OutgoingMessage, ServerInfo,
    JSONRPC_VERSION,
};
use crate::runtime::{AppRuntime, RuntimeConfig, RuntimeError};
use crate::stdio;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const EVENT_BACKLOG_CAPACITY: usize = 256;

#[derive(Debug, Clone)]
pub struct HttpServerConfig {
    pub host: IpAddr,
    pub port: u16,
    pub pairing_code: Option<String>,
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 7319,
            pairing_code: None,
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
    server_info: ServerInfo,
    pairing_code: Mutex<Option<String>>,
    session_token: String,
    events: broadcast::Sender<OutgoingMessage>,
    event_backlog: Mutex<VecDeque<OutgoingMessage>>,
    shutdown: Notify,
}

enum HttpRuntimeCommand {
    Rpc {
        request: JsonRpcRequest,
        respond_to: oneshot::Sender<HttpRuntimeResponse>,
    },
}

#[derive(Debug)]
struct HttpRuntimeResponse {
    response: JsonRpcResponse,
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
    if !config.host.is_loopback() {
        return Err(HttpServerError::NonLoopbackHost);
    }
    let listener = TcpListener::bind(SocketAddr::new(config.host, config.port))
        .await
        .map_err(HttpServerError::Bind)?;
    let mut runtime = AppRuntime::try_new(RuntimeConfig::from_env())?;
    let server_info = runtime.config.server_info.clone();
    let (runtime_event_tx, runtime_event_rx) = mpsc::channel(128);
    runtime.set_event_sender(runtime_event_tx);
    let resumed_runs = runtime.resume_remote_run_streams();
    if resumed_runs > 0 {
        log::info!(
            target: "taskforceai_app_server",
            "resumed {resumed_runs} remote run stream(s)"
        );
    }
    let (events, _) = broadcast::channel(128);
    let (runtime_commands, runtime_command_rx) = mpsc::channel(512);
    let (runtime_outputs, runtime_output_rx) = mpsc::unbounded_channel();
    let pairing_code = config.pairing_code.unwrap_or_else(generate_token);
    let state = Arc::new(HttpServerState {
        runtime_commands,
        server_info,
        pairing_code: Mutex::new(Some(pairing_code.clone())),
        session_token: generate_token(),
        events,
        event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
        shutdown: Notify::new(),
    });
    tokio::spawn(http_runtime_loop(
        runtime,
        runtime_command_rx,
        runtime_event_rx,
        runtime_outputs,
    ));
    tokio::spawn(http_runtime_output_loop(
        Arc::clone(&state),
        runtime_output_rx,
    ));
    let local_addr = listener.local_addr().map_err(HttpServerError::Bind)?;
    write_startup_log(local_addr);
    serve_listener(listener, state).await
}

async fn serve_listener(
    listener: TcpListener,
    state: Arc<HttpServerState>,
) -> Result<(), HttpServerError> {
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(HttpServerError::Accept)?;
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    let _ = handle_connection(stream, state).await;
                });
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
        Ok(request) => request,
        Err(response) => {
            stream.write_all(&response).await?;
            return Ok(());
        }
    };
    if request.method == "GET" && request.path == "/events" {
        handle_event_stream(stream, request, state).await?;
        return Ok(());
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
    match (request.method.as_str(), request.path.as_str()) {
        ("OPTIONS", _) => response_for_request(204, Value::Null, &request),
        ("GET", "/health") => response_for_request(
            200,
            json!({
                "ok": true,
                "server": state.server_info.clone(),
                "transport": {"kind": "http", "encoding": "json"},
            }),
            &request,
        ),
        ("GET", "/pairing") => {
            let Some(code) = request.headers.get("x-taskforce-pairing-code") else {
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
                return response_for_request(
                    403,
                    json!({"error": "invalid pairing code"}),
                    &request,
                );
            }
            *pairing_code = None;
            response_for_request(
                200,
                json!({
                    "sessionToken": state.session_token,
                    "transport": {"kind": "http", "encoding": "json"},
                    "rpcPath": "/rpc",
                    "eventsPath": "/events",
                }),
                &request,
            )
        }
        ("POST", "/pairing-code") => {
            if !authorized(&request, &state.session_token) {
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            }
            let next_code = generate_token();
            let mut pairing_code = state.pairing_code.lock().await;
            *pairing_code = Some(next_code.clone());
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
        ("POST", "/rpc") => {
            if !authorized(&request, &state.session_token) {
                return response_for_request(
                    401,
                    json!({"error": "session token required"}),
                    &request,
                );
            }
            let rpc_request = match serde_json::from_slice::<JsonRpcRequest>(&request.body) {
                Ok(request) => request,
                Err(_) => {
                    return response_for_request(
                        200,
                        json_rpc_response(error_response(None, -32700, "Parse error")),
                        &request,
                    );
                }
            };
            let (rpc_response, action) = handle_rpc_request(rpc_request, Arc::clone(&state)).await;
            if action == stdio::ServerAction::Shutdown {
                state.shutdown.notify_one();
            }
            response_for_request(200, json_rpc_response(rpc_response), &request)
        }
        _ => response_for_request(404, json!({"error": "not found"}), &request),
    }
}

async fn handle_rpc_request(
    request: JsonRpcRequest,
    state: Arc<HttpServerState>,
) -> (JsonRpcResponse, stdio::ServerAction) {
    let id = request.response_id();
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
            error_response(id, -32603, "Runtime unavailable"),
            stdio::ServerAction::Continue,
        );
    }

    match response_rx.await {
        Ok(response) => (response.response, response.action),
        Err(_) => (
            error_response(id, -32603, "Runtime unavailable"),
            stdio::ServerAction::Continue,
        ),
    }
}

async fn http_runtime_loop(
    mut runtime: AppRuntime,
    mut commands: mpsc::Receiver<HttpRuntimeCommand>,
    mut runtime_events: mpsc::Receiver<AppServerEvent>,
    runtime_outputs: mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    loop {
        tokio::select! {
            Some(command) = commands.recv() => {
                match command {
                    HttpRuntimeCommand::Rpc { request, respond_to } => {
                        handle_runtime_rpc(&mut runtime, request, respond_to, &runtime_outputs).await;
                    }
                }
            }
            Some(event) = runtime_events.recv() => {
                handle_runtime_event(&mut runtime, event, &runtime_outputs).await;
            }
            else => break,
        }
    }
}

async fn handle_runtime_rpc(
    runtime: &mut AppRuntime,
    request: JsonRpcRequest,
    respond_to: oneshot::Sender<HttpRuntimeResponse>,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    let id = request.response_id();
    let (messages, action) = stdio::handle_request(request, runtime).await;
    let mut rpc_response = None;
    let mut notifications = Vec::new();
    for message in messages {
        match message {
            OutgoingMessage::Response(response) => {
                rpc_response = Some(response);
            }
            notification => notifications.push(notification),
        }
    }
    if !notifications.is_empty() {
        let _ = runtime_outputs.send(notifications);
    }
    let _ = respond_to.send(HttpRuntimeResponse {
        response: rpc_response.unwrap_or_else(|| ok_response(id, Value::Null)),
        action,
    });
}

async fn handle_runtime_event(
    runtime: &mut AppRuntime,
    event: AppServerEvent,
    runtime_outputs: &mpsc::UnboundedSender<Vec<OutgoingMessage>>,
) {
    let Ok(events) = runtime.apply_event(event) else {
        return;
    };
    let mut messages = events
        .into_iter()
        .flat_map(stdio::event_notifications)
        .collect::<Vec<_>>();
    let Ok(workflow_events) = runtime.advance_ready_workflow_runs().await else {
        return;
    };
    messages.extend(
        workflow_events
            .into_iter()
            .flat_map(stdio::event_notifications),
    );
    if !messages.is_empty() {
        let _ = runtime_outputs.send(messages);
    }
}

async fn http_runtime_output_loop(
    state: Arc<HttpServerState>,
    mut runtime_outputs: mpsc::UnboundedReceiver<Vec<OutgoingMessage>>,
) {
    while let Some(messages) = runtime_outputs.recv().await {
        publish_http_events(&state, messages).await;
    }
}

async fn publish_http_events(state: &Arc<HttpServerState>, messages: Vec<OutgoingMessage>) {
    for message in messages {
        publish_http_event(state, message).await;
    }
}

async fn publish_http_event(state: &Arc<HttpServerState>, message: OutgoingMessage) {
    {
        let mut backlog = state.event_backlog.lock().await;
        if backlog.len() == EVENT_BACKLOG_CAPACITY {
            backlog.pop_front();
        }
        backlog.push_back(message.clone());
    }
    let _ = state.events.send(message);
}

async fn handle_event_stream(
    mut stream: TcpStream,
    request: HttpRequest,
    state: Arc<HttpServerState>,
) -> Result<(), std::io::Error> {
    if !authorized(&request, &state.session_token) {
        stream
            .write_all(&response_for_request(
                401,
                json!({"error": "session token required"}),
                &request,
            ))
            .await?;
        return Ok(());
    }

    let cors_headers = cors_headers(&request);
    stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: keep-alive\r\n{cors_headers}\r\n"
            )
            .as_bytes(),
        )
        .await?;

    let mut receiver = state.events.subscribe();
    let backlog = state.event_backlog.lock().await.clone();
    for message in backlog {
        write_event_line(&mut stream, &message).await?;
    }

    loop {
        match receiver.recv().await {
            Ok(message) => write_event_line(&mut stream, &message).await?,
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
    Ok(())
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
    let bearer = request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "));
    bearer.is_some_and(|value| constant_time_eq(value, session_token))
        || request
            .headers
            .get("x-taskforce-session")
            .is_some_and(|value| constant_time_eq(value, session_token))
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
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
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
        "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type, X-Taskforce-Pairing-Code, X-Taskforce-Session\r\nVary: Origin\r\n"
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

fn write_startup_log(local_addr: SocketAddr) {
    eprintln!(
        "{}",
        json!({
            "level": "info",
            "target": "taskforceai_app_server",
            "message": "taskforceai app-server http transport listening",
            "baseUrl": format!("http://{local_addr}"),
        })
    );
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    async fn test_state(pairing_code: &str, session_token: &str) -> Arc<HttpServerState> {
        let mut runtime = AppRuntime::new(RuntimeConfig::default());
        let server_info = runtime.config.server_info.clone();
        let (runtime_event_tx, runtime_event_rx) = mpsc::channel(128);
        runtime.set_event_sender(runtime_event_tx);
        let (runtime_commands, runtime_command_rx) = mpsc::channel(512);
        let (runtime_outputs, runtime_output_rx) = mpsc::unbounded_channel();
        let (events, _) = broadcast::channel(128);
        let state = Arc::new(HttpServerState {
            runtime_commands,
            server_info,
            pairing_code: Mutex::new(Some(pairing_code.to_string())),
            session_token: session_token.to_string(),
            events,
            event_backlog: Mutex::new(VecDeque::with_capacity(EVENT_BACKLOG_CAPACITY)),
            shutdown: Notify::new(),
        });
        tokio::spawn(http_runtime_loop(
            runtime,
            runtime_command_rx,
            runtime_event_rx,
            runtime_outputs,
        ));
        tokio::spawn(http_runtime_output_loop(
            Arc::clone(&state),
            runtime_output_rx,
        ));
        state
    }

    #[tokio::test]
    async fn pairing_exchanges_code_for_session_token() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "GET".to_string(),
                path: "/pairing".to_string(),
                headers: BTreeMap::from([(
                    "x-taskforce-pairing-code".to_string(),
                    "pair-me".to_string(),
                )]),
                body: Vec::new(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.contains("\"sessionToken\":\"session-token\""));
    }

    #[tokio::test]
    async fn pairing_code_is_single_use() {
        let state = test_state("pair-me", "session-token").await;
        let headers = BTreeMap::from([(
            "x-taskforce-pairing-code".to_string(),
            "pair-me".to_string(),
        )]);
        let first = route_request(
            HttpRequest {
                method: "GET".to_string(),
                path: "/pairing".to_string(),
                headers: headers.clone(),
                body: Vec::new(),
            },
            Arc::clone(&state),
        )
        .await;
        let second = route_request(
            HttpRequest {
                method: "GET".to_string(),
                path: "/pairing".to_string(),
                headers,
                body: Vec::new(),
            },
            state,
        )
        .await;
        let first = String::from_utf8(first).expect("response should be utf8");
        let second = String::from_utf8(second).expect("response should be utf8");
        assert!(first.starts_with("HTTP/1.1 200 OK"));
        assert!(second.starts_with("HTTP/1.1 403 Forbidden"));
    }

    #[tokio::test]
    async fn authenticated_session_can_mint_pairing_code() {
        let state = test_state("old-code", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/pairing-code".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: Vec::new(),
            },
            Arc::clone(&state),
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 200 OK"));
        assert!(text.contains("\"pairingCode\":"));

        let next_code = state
            .pairing_code
            .lock()
            .await
            .clone()
            .expect("pairing code should be minted");
        assert_ne!(next_code, "old-code");
    }

    #[tokio::test]
    async fn http_transport_rejects_non_loopback_bindings() {
        let err = run_http(HttpServerConfig {
            host: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            port: 0,
            pairing_code: Some("pair-me".to_string()),
        })
        .await
        .expect_err("non-loopback host should be rejected");

        assert!(matches!(err, HttpServerError::NonLoopbackHost));
    }

    #[tokio::test]
    async fn mint_pairing_code_requires_session_token() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/pairing-code".to_string(),
                headers: BTreeMap::new(),
                body: Vec::new(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 401 Unauthorized"));
    }

    #[tokio::test]
    async fn rpc_requires_session_token() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::new(),
                body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 401 Unauthorized"));
    }

    #[tokio::test]
    async fn options_returns_cors_preflight_headers() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "OPTIONS".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "origin".to_string(),
                    "http://localhost:3210".to_string(),
                )]),
                body: Vec::new(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 204"));
        assert!(text.contains("Content-Length: 0"));
        assert!(text.contains("Access-Control-Allow-Origin: http://localhost:3210"));
        assert!(text.contains("X-Taskforce-Pairing-Code"));
        assert!(!text.ends_with("null"));
    }

    #[tokio::test]
    async fn options_rejects_unknown_cors_origin() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "OPTIONS".to_string(),
                path: "/pairing".to_string(),
                headers: BTreeMap::from([(
                    "origin".to_string(),
                    "https://evil.example".to_string(),
                )]),
                body: Vec::new(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.starts_with("HTTP/1.1 204"));
        assert!(text.contains("Content-Length: 0"));
        assert!(!text.contains("Access-Control-Allow-Origin"));
        assert!(!text.ends_with("null"));
    }

    #[tokio::test]
    async fn rpc_ping_accepts_session_token() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: br#"{"jsonrpc":"2.0","id":1,"method":"server.ping","params":{}}"#.to_vec(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.contains("\"result\":{\"ok\":true}"));
    }

    #[tokio::test]
    async fn rpc_shutdown_notifies_http_listener() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: br#"{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}"#.to_vec(),
            },
            Arc::clone(&state),
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.contains("\"result\":{\"ok\":true}"));
        tokio::time::timeout(Duration::from_secs(1), state.shutdown.notified())
            .await
            .expect("shutdown should notify listener");
    }

    #[tokio::test]
    async fn rpc_dispatches_runtime_commands_over_http() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: br#"{"jsonrpc":"2.0","id":1,"method":"status.summary","params":{}}"#.to_vec(),
            },
            state,
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.contains("\"transport\":\"stdio/jsonl\""));
        assert!(text.contains("\"runCount\":0"));
    }

    #[tokio::test]
    async fn rpc_publishes_event_notifications_to_http_backlog() {
        let state = test_state("pair-me", "session-token").await;
        let response = route_request(
            HttpRequest {
                method: "POST".to_string(),
                path: "/rpc".to_string(),
                headers: BTreeMap::from([(
                    "authorization".to_string(),
                    "Bearer session-token".to_string(),
                )]),
                body: br#"{"jsonrpc":"2.0","id":1,"method":"run.submit","params":{"prompt":"hello remote events"}}"#.to_vec(),
            },
            Arc::clone(&state),
        )
        .await;
        let text = String::from_utf8(response).expect("response should be utf8");
        assert!(text.contains("\"result\":{\"run\":"));

        let backlog = state.event_backlog.lock().await;
        assert!(
            backlog.iter().any(|message| matches!(
                message,
                OutgoingMessage::Notification(notification)
                    if notification.method == "event"
                        && notification.params["type"] == "run_updated"
            )),
            "run.submit should publish its immediate run event"
        );
    }
}
