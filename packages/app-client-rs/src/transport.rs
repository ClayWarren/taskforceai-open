use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::Value;
use taskforceai_app_protocol::{AppServerEvent, JsonRpcNotification, JsonRpcResponse};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

pub(crate) enum AppServerTransport {
    Stdio {
        child: Child,
        stdin: Arc<Mutex<ChildStdin>>,
        responses: Arc<Mutex<mpsc::Receiver<JsonRpcResponse>>>,
        events: mpsc::Receiver<AppServerEvent>,
    },
    Http {
        base_url: String,
        session_token: String,
        client: reqwest::Client,
        event_client: reqwest::Client,
        events: Option<mpsc::Receiver<AppServerEvent>>,
        event_task: Option<JoinHandle<()>>,
    },
}

pub(crate) async fn read_loop(
    stdout: tokio::process::ChildStdout,
    response_tx: mpsc::Sender<JsonRpcResponse>,
    event_tx: mpsc::Sender<AppServerEvent>,
) {
    read_stdio_lines(BufReader::new(stdout).lines(), response_tx, event_tx).await;
}

pub(crate) async fn read_stdio_lines<R>(
    mut lines: Lines<R>,
    response_tx: mpsc::Sender<JsonRpcResponse>,
    event_tx: mpsc::Sender<AppServerEvent>,
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
            if let Ok(notification) = serde_json::from_value::<JsonRpcNotification>(raw) {
                if notification.method == "event" {
                    if let Ok(event) = serde_json::from_value::<AppServerEvent>(notification.params)
                    {
                        send_event_nonblocking(&event_tx, event);
                    }
                }
            }
            continue;
        }
        if let Ok(response) = serde_json::from_value::<JsonRpcResponse>(raw) {
            if response_tx.send(response).await.is_err() {
                log::warn!(target: "app_client", "app-server response receiver closed");
                break;
            }
        }
    }
}

pub(crate) async fn read_http_events(
    base_url: String,
    session_token: String,
    client: reqwest::Client,
    event_tx: mpsc::Sender<AppServerEvent>,
) {
    let Ok(response) = client
        .get(format!("{base_url}/events"))
        .header("X-Taskforce-Session", session_token)
        .send()
        .await
    else {
        log::warn!(target: "app_client", "failed to connect to app-server HTTP event stream");
        return;
    };
    let Ok(response) = response.error_for_status() else {
        log::warn!(target: "app_client", "app-server HTTP event stream returned an error status");
        return;
    };
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            log::warn!(target: "app_client", "app-server HTTP event stream read failed");
            break;
        };
        buffer.extend_from_slice(&chunk);
        let mut line_start = 0;
        while let Some(index) = buffer[line_start..].iter().position(|byte| *byte == b'\n') {
            let line_end = line_start + index;
            handle_http_event_line(&buffer[line_start..line_end], &event_tx);
            line_start = line_end + 1;
        }
        if line_start == buffer.len() {
            buffer.clear();
        } else if line_start > 0 {
            buffer.drain(..line_start);
        }
    }
    if !buffer.is_empty() {
        handle_http_event_line(&buffer, &event_tx);
    }
}

pub(crate) fn handle_http_event_line(line: &[u8], event_tx: &mpsc::Sender<AppServerEvent>) {
    let line = trim_ascii_whitespace(line);
    if line.is_empty() {
        return;
    }
    let Ok(notification) = serde_json::from_slice::<JsonRpcNotification>(line) else {
        if serde_json::from_slice::<Value>(line).is_err() {
            log::warn!(target: "app_client", "app-server HTTP event stream emitted invalid JSON");
        }
        return;
    };
    if notification.method == "event" {
        if let Ok(event) = serde_json::from_value::<AppServerEvent>(notification.params) {
            send_event_nonblocking(event_tx, event);
        }
    }
}

fn trim_ascii_whitespace(mut value: &[u8]) -> &[u8] {
    while matches!(value.first(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
        value = &value[1..];
    }
    while matches!(value.last(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
        value = &value[..value.len() - 1];
    }
    value
}

pub(crate) fn send_event_nonblocking(
    event_tx: &mpsc::Sender<AppServerEvent>,
    event: AppServerEvent,
) {
    if event_tx.try_send(event).is_err() {
        log::warn!(target: "app_client", "app-server event receiver is closed or full");
    }
}
