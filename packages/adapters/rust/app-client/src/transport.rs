use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::Value;
use taskforceai_app_protocol::{
    AppServerEvent, JsonRpcNotification, JsonRpcResponse, JsonRpcServerRequest,
};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;

pub(crate) const EVENT_CHANNEL_CAPACITY: usize = 1024;
pub(crate) const MAX_HTTP_EVENT_LINE_BYTES: usize = 1024 * 1024;

const HTTP_EVENT_RECONNECT_INITIAL_DELAY: Duration = Duration::from_millis(250);
const HTTP_EVENT_RECONNECT_MAX_DELAY: Duration = Duration::from_secs(5);

pub(crate) type PendingResponses = Arc<Mutex<HashMap<u64, oneshot::Sender<JsonRpcResponse>>>>;
pub(crate) type EventSender = broadcast::Sender<AppServerEventMessage>;
pub(crate) type EventReceiver = broadcast::Receiver<AppServerEventMessage>;

#[derive(Debug, Clone)]
pub(crate) enum AppServerEventMessage {
    Event(AppServerEvent),
    StreamError { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HttpEventStreamOutcome {
    Closed,
    Retry,
}

pub(crate) enum AppServerTransport {
    Stdio {
        child: Child,
        stdin: Arc<Mutex<ChildStdin>>,
        pending_responses: PendingResponses,
        events: EventReceiver,
    },
    Http {
        base_url: String,
        session_token: String,
        client: reqwest::Client,
        event_client: reqwest::Client,
        events: Option<EventReceiver>,
        event_task: Option<JoinHandle<()>>,
    },
}

pub(crate) async fn read_loop(
    stdout: tokio::process::ChildStdout,
    pending_responses: PendingResponses,
    event_tx: EventSender,
) {
    read_stdio_lines(BufReader::new(stdout).lines(), pending_responses, event_tx).await;
}

pub(crate) async fn read_stdio_lines<R>(
    mut lines: Lines<R>,
    pending_responses: PendingResponses,
    event_tx: EventSender,
) where
    R: AsyncBufRead + Unpin,
{
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                log::warn!(target: "app_client", "app-server stdio read loop failed: {error}");
                break;
            }
        };
        let Ok(raw) = serde_json::from_str::<Value>(&line) else {
            log::warn!(target: "app_client", "app-server stdio emitted invalid JSON");
            continue;
        };
        if raw.get("method").is_some() {
            if raw.get("id").is_some() {
                if let Ok(request) = serde_json::from_value::<JsonRpcServerRequest>(raw) {
                    send_event_nonblocking(&event_tx, AppServerEvent::ServerRequest { request });
                } else {
                    log::debug!(target: "app_client", "app-server emitted malformed server request");
                }
                continue;
            }
            if let Ok(notification) = serde_json::from_value::<JsonRpcNotification>(raw) {
                if notification.method == "event" {
                    if let Ok(event) = serde_json::from_value::<AppServerEvent>(notification.params)
                    {
                        send_event_nonblocking(&event_tx, event);
                    } else {
                        log::debug!(target: "app_client", "app-server stdio emitted malformed event notification");
                    }
                } else {
                    log::debug!(target: "app_client", "app-server stdio emitted unhandled notification");
                }
            } else {
                log::debug!(target: "app_client", "app-server stdio emitted malformed notification");
            }
            continue;
        }
        if let Ok(response) = serde_json::from_value::<JsonRpcResponse>(raw) {
            route_stdio_response(&pending_responses, response).await;
        } else {
            log::debug!(target: "app_client", "app-server stdio emitted unrecognized JSON message");
        }
    }

    pending_responses.lock().await.clear();
}

pub(crate) async fn route_stdio_response(
    pending_responses: &PendingResponses,
    response: JsonRpcResponse,
) {
    let Some(id) = response.id.as_ref().and_then(Value::as_u64) else {
        log::debug!(target: "app_client", "app-server stdio response missing numeric id");
        return;
    };
    let sender = pending_responses.lock().await.remove(&id);
    let Some(sender) = sender else {
        log::debug!(target: "app_client", "app-server stdio response had no pending request");
        return;
    };
    if sender.send(response).is_err() {
        log::debug!(target: "app_client", "app-server stdio response receiver dropped before delivery");
    }
}

pub(crate) async fn read_http_events(
    base_url: String,
    session_token: String,
    client: reqwest::Client,
    event_tx: EventSender,
) {
    let mut reconnect_delay = HTTP_EVENT_RECONNECT_INITIAL_DELAY;

    loop {
        match read_http_events_once(
            base_url.clone(),
            session_token.clone(),
            client.clone(),
            event_tx.clone(),
        )
        .await
        {
            HttpEventStreamOutcome::Closed | HttpEventStreamOutcome::Retry => {
                sleep(reconnect_delay).await;
                reconnect_delay = (reconnect_delay * 2).min(HTTP_EVENT_RECONNECT_MAX_DELAY);
            }
        }
    }
}

pub(crate) async fn read_http_events_once(
    base_url: String,
    session_token: String,
    client: reqwest::Client,
    event_tx: EventSender,
) -> HttpEventStreamOutcome {
    let response = match client
        .get(format!("{base_url}/events"))
        .header("X-Taskforce-Session", session_token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let message = format!("failed to connect to app-server HTTP event stream: {error}");
            log::warn!(target: "app_client", "{message}");
            send_event_stream_error(&event_tx, message);
            return HttpEventStreamOutcome::Retry;
        }
    };
    let response = match response.error_for_status() {
        Ok(response) => response,
        Err(error) => {
            let message = format!("app-server HTTP event stream returned an error status: {error}");
            log::warn!(target: "app_client", "{message}");
            send_event_stream_error(&event_tx, message);
            return HttpEventStreamOutcome::Retry;
        }
    };
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let message = format!("app-server HTTP event stream read failed: {error}");
                log::warn!(target: "app_client", "{message}");
                send_event_stream_error(&event_tx, message);
                return HttpEventStreamOutcome::Retry;
            }
        };
        buffer.extend_from_slice(&chunk);
        let mut line_start = 0;
        while let Some(index) = buffer[line_start..].iter().position(|byte| *byte == b'\n') {
            let line_end = line_start + index;
            let line = &buffer[line_start..line_end];
            if line.len() > MAX_HTTP_EVENT_LINE_BYTES {
                log::warn!(target: "app_client", "app-server HTTP event stream emitted an oversized line");
            } else {
                handle_http_event_line(line, &event_tx);
            }
            line_start = line_end + 1;
        }
        if line_start == buffer.len() {
            buffer.clear();
        } else if line_start > 0 {
            buffer.drain(..line_start);
        }
        if buffer.len() > MAX_HTTP_EVENT_LINE_BYTES {
            log::warn!(target: "app_client", "app-server HTTP event stream line exceeded maximum size");
            buffer.clear();
        }
    }
    if !buffer.is_empty() {
        handle_http_event_line(&buffer, &event_tx);
    }
    HttpEventStreamOutcome::Closed
}

pub(crate) fn handle_http_event_line(line: &[u8], event_tx: &EventSender) {
    let line = line.trim_ascii();
    if line.is_empty() {
        return;
    }
    if let Ok(request) = serde_json::from_slice::<JsonRpcServerRequest>(line) {
        send_event_nonblocking(event_tx, AppServerEvent::ServerRequest { request });
        return;
    }
    let Ok(notification) = serde_json::from_slice::<JsonRpcNotification>(line) else {
        if serde_json::from_slice::<Value>(line).is_err() {
            log::warn!(target: "app_client", "app-server HTTP event stream emitted invalid JSON");
        } else {
            log::debug!(target: "app_client", "app-server HTTP event stream emitted malformed notification");
        }
        return;
    };
    if notification.method == "event" {
        if let Ok(event) = serde_json::from_value::<AppServerEvent>(notification.params) {
            send_event_nonblocking(event_tx, event);
        } else {
            log::debug!(target: "app_client", "app-server HTTP event stream emitted malformed event notification");
        }
    } else {
        log::debug!(target: "app_client", "app-server HTTP event stream emitted unhandled notification");
    }
}

pub(crate) fn send_event_nonblocking(event_tx: &EventSender, event: AppServerEvent) {
    if event_tx.send(AppServerEventMessage::Event(event)).is_err() {
        log::warn!(target: "app_client", "app-server event receiver is closed");
    }
}

fn send_event_stream_error(event_tx: &EventSender, message: String) {
    if event_tx
        .send(AppServerEventMessage::StreamError { message })
        .is_err()
    {
        log::warn!(target: "app_client", "app-server event receiver is closed");
    }
}
