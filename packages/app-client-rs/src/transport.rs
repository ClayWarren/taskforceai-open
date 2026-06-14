use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::Value;
use taskforceai_app_protocol::{AppServerEvent, JsonRpcNotification, JsonRpcResponse};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

pub(crate) enum AppServerTransport {
    Stdio {
        child: Child,
        stdin: Arc<Mutex<ChildStdin>>,
        responses: mpsc::Receiver<JsonRpcResponse>,
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
    let mut lines = BufReader::new(stdout).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) | Err(_) => break,
        };
        let Ok(raw) = serde_json::from_str::<Value>(&line) else {
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
            let _ = response_tx.send(response).await;
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
        return;
    };
    let Ok(response) = response.error_for_status() else {
        return;
    };
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            break;
        };
        buffer.extend_from_slice(&chunk);
        while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=index).collect::<Vec<_>>();
            handle_http_event_line(&line, &event_tx).await;
        }
    }
    if !buffer.is_empty() {
        handle_http_event_line(&buffer, &event_tx).await;
    }
}

pub(crate) async fn handle_http_event_line(line: &[u8], event_tx: &mpsc::Sender<AppServerEvent>) {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    let Ok(raw) = serde_json::from_str::<Value>(line) else {
        return;
    };
    if raw.get("method").is_some() {
        let Ok(notification) = serde_json::from_value::<JsonRpcNotification>(raw) else {
            return;
        };
        if notification.method == "event" {
            if let Ok(event) = serde_json::from_value::<AppServerEvent>(notification.params) {
                send_event_nonblocking(event_tx, event);
            }
        }
    }
}

pub(crate) fn send_event_nonblocking(
    event_tx: &mpsc::Sender<AppServerEvent>,
    event: AppServerEvent,
) {
    let _ = event_tx.try_send(event);
}
