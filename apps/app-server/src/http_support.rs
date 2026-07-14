use super::*;

#[derive(Debug, Clone)]
pub(super) struct RemotePushNotification {
    pub(super) title: String,
    pub(super) body: String,
    pub(super) kind: String,
    pub(super) thread_id: String,
}

pub(super) fn remote_push_notification(
    message: &OutgoingMessage,
) -> Option<RemotePushNotification> {
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
pub(super) async fn send_remote_push_notifications(
    tokens: Vec<String>,
    notification: RemotePushNotification,
) {
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

pub(super) fn valid_expo_push_token(token: &str) -> bool {
    let valid_prefix =
        token.starts_with("ExponentPushToken[") || token.starts_with("ExpoPushToken[");
    valid_prefix && token.ends_with(']') && token.len() <= 256
}

pub(super) async fn subscribe_http_events(
    state: &HttpServerState,
) -> (
    broadcast::Receiver<OutgoingMessage>,
    VecDeque<OutgoingMessage>,
) {
    let backlog = state.event_backlog.lock().await;
    let receiver = state.events.subscribe();
    (receiver, backlog.clone())
}

pub(super) async fn handle_event_stream(
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

pub(super) async fn write_event_line(
    stream: &mut TcpStream,
    message: &OutgoingMessage,
) -> Result<(), std::io::Error> {
    let mut encoded = serde_json::to_vec(message).expect("event message should serialize");
    encoded.push(b'\n');
    stream.write_all(&encoded).await?;
    stream.flush().await
}

pub(super) fn authorized(request: &HttpRequest, session_token: &str) -> bool {
    request_session_token(request).is_some_and(|value| constant_time_eq(value, session_token))
}

pub(super) fn request_session_token(request: &HttpRequest) -> Option<&str> {
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
pub(super) enum HttpSessionAccess {
    Local,
    Mobile,
}

pub(super) async fn session_access(
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

pub(super) fn constant_time_eq(left: &str, right: &str) -> bool {
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

pub(super) fn find_header_end(buffer: &[u8]) -> Option<usize> {
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

pub(super) fn response(status: u16, body: Value) -> Vec<u8> {
    response_with_cors(status, body, "")
}

pub(super) fn response_for_request(status: u16, body: Value, request: &HttpRequest) -> Vec<u8> {
    response_with_cors(status, body, &cors_headers(request))
}

pub(super) fn response_with_cors(status: u16, body: Value, cors_headers: &str) -> Vec<u8> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        408 => "Request Timeout",
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

pub(super) fn cors_headers(request: &HttpRequest) -> String {
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

pub(super) fn is_allowed_cors_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://localhost:3210"
            | "http://127.0.0.1:3210"
            | "tauri://localhost"
            | "https://taskforceai.chat"
            | "https://www.taskforceai.chat"
    )
}

pub(super) fn json_rpc_response(response: JsonRpcResponse) -> Value {
    serde_json::to_value(response).expect("json-rpc response should serialize")
}

#[cfg(test)]
pub(super) fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

pub(super) fn error_response(
    id: Option<Value>,
    code: i64,
    message: impl Into<String>,
) -> JsonRpcResponse {
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

pub(super) fn generate_token() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(super) fn write_startup_log(local_addr: SocketAddr, advertise_host: Option<IpAddr>) {
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
