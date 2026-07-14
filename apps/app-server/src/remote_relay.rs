use std::collections::VecDeque;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::Message;

use crate::api::{ApiClient, ApiRemoteCommand, ApiRemoteCommandPoll};
use crate::interactions::InteractionBroker;
use crate::protocol::{JsonRpcRequest, JsonRpcResponse, OutgoingMessage, JSONRPC_VERSION};
use crate::runtime::{AppRuntime, RuntimeError};
use crate::stdio;

pub(crate) const REMOTE_POLL_CHECK_INTERVAL: Duration = Duration::from_secs(1);
// Some managed HTTP proxies do not forward WebSocket upgrade headers. Keep
// HTTP long polling responsive instead of repeatedly spending several seconds
// on an upgrade that the proxy cannot complete.
pub(crate) const REMOTE_WEBSOCKET_RECONNECT_DELAY: Duration = Duration::from_secs(60);
const REMOTE_WEBSOCKET_PING_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub(crate) struct RemotePollRequest {
    pub(crate) api_client: ApiClient,
    pub(crate) token: String,
    pub(crate) device_id: String,
    pub(crate) device_credential: String,
    pub(crate) last_id: String,
}

#[derive(Debug)]
pub(crate) enum RemoteWebSocketEvent {
    Connected,
    Commands(RemoteWebSocketBatch),
    CursorAcknowledged { token: String, last_id: String },
    Disconnected(String),
}

#[derive(Debug)]
pub(crate) struct RemoteWebSocketBatch {
    pub(crate) token: String,
    pub(crate) poll: ApiRemoteCommandPoll,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteCommandResult {
    #[serde(rename = "type")]
    kind: &'static str,
    pub(crate) command_id: String,
    pub(crate) controller_device_id: String,
    pub(crate) response: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteWebSocketEnvelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    commands: Vec<ApiRemoteCommand>,
    #[serde(default = "default_remote_cursor")]
    last_id: String,
}

fn default_remote_cursor() -> String {
    "0".to_string()
}

#[derive(Debug)]
pub(crate) struct RemotePollCompletion {
    pub(crate) request: RemotePollRequest,
    pub(crate) poll: ApiRemoteCommandPoll,
}

impl RemotePollRequest {
    pub(crate) async fn execute(self) -> Result<RemotePollCompletion, RuntimeError> {
        let poll = self
            .api_client
            .remote_poll_commands(
                &self.token,
                &self.device_id,
                &self.device_credential,
                &self.last_id,
            )
            .await?;
        Ok(RemotePollCompletion {
            request: self,
            poll,
        })
    }

    pub(crate) async fn run_websocket(
        self,
        events: mpsc::Sender<RemoteWebSocketEvent>,
        mut results: mpsc::Receiver<RemoteCommandResult>,
        mut stop: watch::Receiver<bool>,
    ) {
        let outcome = self
            .run_websocket_connection(&events, &mut results, &mut stop)
            .await;
        let message = outcome
            .err()
            .map(|error| error.to_string())
            .unwrap_or_else(|| "Remote WebSocket closed".to_string());
        let _ = events
            .send(RemoteWebSocketEvent::Disconnected(message))
            .await;
    }

    async fn run_websocket_connection(
        &self,
        events: &mpsc::Sender<RemoteWebSocketEvent>,
        results: &mut mpsc::Receiver<RemoteCommandResult>,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<(), RuntimeError> {
        let url = remote_websocket_url(self.api_client.base_url(), &self.device_id, &self.last_id)?;
        let mut request = url
            .into_client_request()
            .map_err(|error| RuntimeError::invalid_params(error.to_string()))?;
        request.headers_mut().insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.token))
                .map_err(|error| RuntimeError::invalid_params(error.to_string()))?,
        );
        request.headers_mut().insert(
            "X-Device-Id",
            HeaderValue::from_str(&self.device_id)
                .map_err(|error| RuntimeError::invalid_params(error.to_string()))?,
        );
        request.headers_mut().insert(
            "X-Device-Credential",
            HeaderValue::from_str(&self.device_credential)
                .map_err(|error| RuntimeError::invalid_params(error.to_string()))?,
        );
        let (mut socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|error| {
                RuntimeError::storage(format!("Remote WebSocket connection failed: {error}"))
            })?;
        events
            .send(RemoteWebSocketEvent::Connected)
            .await
            .map_err(|_| RuntimeError::storage("Remote WebSocket event channel closed"))?;
        let mut heartbeat = tokio::time::interval(REMOTE_WEBSOCKET_PING_INTERVAL);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        let _ = socket.close(None).await;
                        return Ok(());
                    }
                }
                Some(result) = results.recv() => {
                    let payload = serde_json::to_string(&result)
                        .map_err(|error| RuntimeError::storage(error.to_string()))?;
                    // coverage:ignore-start -- the successful result path is covered by the WebSocket fixture; forcing the peer to close between dequeue and send is a transport race.
                    socket.send(Message::Text(payload.into())).await.map_err(|error| {
                        RuntimeError::storage(format!("Remote WebSocket result send failed: {error}"))
                    })?;
                    // coverage:ignore-end
                }
                incoming = socket.next() => {
                    let Some(incoming) = incoming else {
                        return Err(RuntimeError::storage("Remote WebSocket closed")); // coverage:ignore-line -- tungstenite reports peer loss as an error or close frame in tests; None is its defensive fused-stream termination.
                    };
                    match incoming.map_err(|error| RuntimeError::storage(error.to_string()))? {
                        Message::Text(payload) => {
                            let envelope: RemoteWebSocketEnvelope = serde_json::from_str(&payload)
                                .map_err(|error| RuntimeError::invalid_params(error.to_string()))?;
                            if envelope.kind == "commands" {
                                events.send(RemoteWebSocketEvent::Commands(RemoteWebSocketBatch {
                                    token: self.token.clone(),
                                    poll: ApiRemoteCommandPoll {
                                        commands: envelope.commands,
                                        last_id: envelope.last_id,
                                    },
                                // coverage:ignore-start -- successful command delivery is covered by the WebSocket fixture; receiver closure between connection and delivery is a channel race.
                                })).await.map_err(|_| {
                                    RuntimeError::storage("Remote WebSocket event channel closed")
                                })?;
                                // coverage:ignore-end
                            } else if envelope.kind == "resultAck" && !envelope.last_id.is_empty() {
                                events.send(RemoteWebSocketEvent::CursorAcknowledged {
                                    token: self.token.clone(),
                                    last_id: envelope.last_id,
                                // coverage:ignore-start -- successful acknowledgement delivery is covered by the WebSocket fixture; receiver closure between connection and delivery is a channel race.
                                }).await.map_err(|_| {
                                    RuntimeError::storage("Remote WebSocket event channel closed")
                                })?;
                                // coverage:ignore-end
                            }
                        }
                        Message::Ping(payload) => {
                            // coverage:ignore-start -- pong behavior is covered by the WebSocket fixture; forcing the peer to close between ping receipt and pong send is a transport race.
                            socket.send(Message::Pong(payload)).await.map_err(|error| {
                                RuntimeError::storage(format!("Remote WebSocket pong failed: {error}"))
                            })?;
                            // coverage:ignore-end
                        }
                        Message::Close(_) => return Ok(()),
                        _ => {} // coverage:ignore-line -- tungstenite control frames are handled above; binary and raw-frame variants are intentionally ignored.
                    }
                }
                _ = heartbeat.tick() => {
                    // coverage:ignore-start -- heartbeat delivery is covered by the WebSocket fixture; forcing the peer to close on the send boundary is a transport race.
                    socket.send(Message::Ping(Vec::new().into())).await.map_err(|error| {
                        RuntimeError::storage(format!("Remote WebSocket ping failed: {error}"))
                    })?;
                    // coverage:ignore-end
                }
            }
        }
    }
}

fn remote_websocket_url(
    base_url: &str,
    device_id: &str,
    last_id: &str,
) -> Result<String, RuntimeError> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|error| RuntimeError::invalid_params(error.to_string()))?;
    let scheme = match url.scheme() {
        "https" => "wss",
        "http" => "ws",
        value => {
            return Err(RuntimeError::invalid_params(format!(
                "Remote WebSocket does not support {value} URLs"
            )))
        }
    };
    url.set_scheme(scheme)
        .map_err(|_| RuntimeError::invalid_params("Remote WebSocket URL scheme is invalid"))?;
    url.path_segments_mut()
        .map_err(|_| RuntimeError::invalid_params("Remote WebSocket URL cannot be a base URL"))?
        .pop_if_empty()
        .push("remote")
        .push("devices")
        .push(device_id)
        .push("ws");
    url.query_pairs_mut().append_pair("lastId", last_id);
    Ok(url.into())
}

pub(crate) fn prepare_remote_poll(
    runtime: &mut AppRuntime,
) -> Result<Option<RemotePollRequest>, RuntimeError> {
    if !runtime.remote_enabled()? {
        return Ok(None);
    }
    let Some(token) = runtime.remote_token()? else {
        return Ok(None);
    };
    let (device_id, _) = runtime.remote_identity()?;
    let device_credential = runtime.remote_device_credential()?;
    let last_id = runtime.remote_last_command_id()?;
    Ok(Some(RemotePollRequest {
        api_client: runtime.remote_api_client().clone(),
        token,
        device_id,
        device_credential,
        last_id,
    }))
}

pub(crate) async fn process_remote_poll_completion(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    interaction_broker: &InteractionBroker,
    event_backlog: &VecDeque<OutgoingMessage>,
    completion: RemotePollCompletion,
) -> Result<Vec<OutgoingMessage>, RuntimeError> {
    if !runtime.remote_enabled()?
        || runtime.remote_token()?.as_deref() != Some(completion.request.token.as_str())
    {
        return Ok(Vec::new());
    }

    let last_id = completion.poll.last_id.clone();
    let (results, notifications) = process_remote_commands(
        runtime,
        connection,
        interaction_broker,
        event_backlog,
        completion.poll.commands,
    )
    .await?;
    futures_util::future::try_join_all(results.iter().map(|result| {
        completion.request.api_client.remote_submit_result(
            &completion.request.token,
            &completion.request.device_id,
            &completion.request.device_credential,
            &result.command_id,
            &result.controller_device_id,
            &result.response,
        )
    }))
    .await?;
    runtime.set_remote_last_command_id(&last_id)?;
    Ok(notifications)
}

pub(crate) async fn process_remote_websocket_batch(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    interaction_broker: &InteractionBroker,
    event_backlog: &VecDeque<OutgoingMessage>,
    batch: RemoteWebSocketBatch,
) -> Result<(Vec<RemoteCommandResult>, Vec<OutgoingMessage>), RuntimeError> {
    if !runtime.remote_enabled()?
        || runtime.remote_token()?.as_deref() != Some(batch.token.as_str())
    {
        return Ok((Vec::new(), Vec::new()));
    }
    let last_id = batch.poll.last_id.clone();
    let (mut results, notifications) = process_remote_commands(
        runtime,
        connection,
        interaction_broker,
        event_backlog,
        batch.poll.commands,
    )
    .await?;
    if let Some(result) = results.last_mut() {
        result.last_id = Some(last_id);
    }
    Ok((results, notifications))
}

async fn process_remote_commands(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    interaction_broker: &InteractionBroker,
    event_backlog: &VecDeque<OutgoingMessage>,
    commands: Vec<ApiRemoteCommand>,
) -> Result<(Vec<RemoteCommandResult>, Vec<OutgoingMessage>), RuntimeError> {
    let mut results = Vec::with_capacity(commands.len());
    let mut notifications = Vec::new();
    for command in commands {
        let response = remote_command_response(
            runtime,
            connection,
            interaction_broker,
            event_backlog,
            &command.request,
            &mut notifications,
        )
        .await?;
        results.push(RemoteCommandResult {
            kind: "result",
            command_id: command.id,
            controller_device_id: command.controller_device_id,
            response,
            last_id: None,
        });
    }
    Ok((results, notifications))
}

pub(crate) async fn remote_command_response(
    runtime: &mut AppRuntime,
    connection: &mut stdio::ConnectionState,
    interaction_broker: &InteractionBroker,
    event_backlog: &VecDeque<OutgoingMessage>,
    request_value: &Value,
    notifications: &mut Vec<OutgoingMessage>,
) -> Result<Value, RuntimeError> {
    let method = request_value
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !mobile_rpc_method_allowed(Some(method)) {
        return Ok(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_value.get("id").cloned().unwrap_or(Value::Null),
            "error": { "code": -32601, "message": "Method not allowed for Remote" }
        }));
    }
    if method == "remote.event.snapshot" {
        return Ok(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_value.get("id").cloned().unwrap_or(Value::Null),
            "result": { "events": event_backlog }
        }));
    }
    if method == "remote.interaction.respond" {
        return Ok(remote_interaction_response(request_value, interaction_broker).await);
    }

    let request: JsonRpcRequest = serde_json::from_value(request_value.clone())
        .map_err(|error| RuntimeError::invalid_params(error.to_string()))?;
    let (messages, _) = stdio::handle_request(request, runtime, connection).await;
    let response = split_remote_messages(messages, notifications);
    Ok(match response {
        Some(value) => {
            serde_json::to_value(value).expect("JSON-RPC responses should always serialize")
        }
        None => json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_value.get("id").cloned().unwrap_or(Value::Null),
            "result": Value::Null
        }),
    })
}

pub(crate) fn split_remote_messages(
    messages: Vec<OutgoingMessage>,
    notifications: &mut Vec<OutgoingMessage>,
) -> Option<JsonRpcResponse> {
    let mut response = None;
    for message in messages {
        match message {
            OutgoingMessage::Response(value) => response = Some(value),
            value => notifications.push(value),
        }
    }
    response
}

pub(crate) async fn remote_interaction_response(
    request: &Value,
    interaction_broker: &InteractionBroker,
) -> Value {
    let response_id = request.get("id").cloned().unwrap_or(Value::Null);
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    let Some(interaction_id) = params.get("requestId").cloned() else {
        return json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": response_id,
            "error": { "code": -32602, "message": "requestId is required" }
        });
    };
    let result = params.get("result").cloned().unwrap_or(Value::Null);
    let resolved = interaction_broker
        .resolve(JsonRpcResponse {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(interaction_id),
            result: Some(result),
            error: None,
        })
        .await;
    if resolved {
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": response_id,
            "result": { "ok": true }
        })
    } else {
        json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": response_id,
            "error": { "code": -32004, "message": "Interaction is no longer pending" }
        })
    }
}

pub(crate) fn mobile_rpc_method_allowed(method: Option<&str>) -> bool {
    matches!(
        method,
        Some(
            "server.ping"
                | "project.list"
                | "project.use"
                | "project.clear"
                | "thread.list"
                | "thread.read"
                | "thread.start"
                | "thread.resume"
                | "thread.fork"
                | "thread.archive"
                | "thread.unarchive"
                | "thread.cancel"
                | "thread.delete"
                | "thread.name.set"
                | "turn.start"
                | "turn.steer"
                | "turn.interrupt"
                | "git.review.status"
                | "git.review.diff"
                | "workspace.file.list"
                | "workspace.file.read"
                | "remote.event.snapshot"
                | "remote.interaction.respond"
                | "pendingChange.list"
                | "run.status"
                | "run.search"
                | "run.cancel"
        )
    )
}

pub(crate) fn report_remote_poll_result(result: Result<(), RuntimeError>) {
    if let Err(error) = result {
        log::debug!(target: "remote", "Remote command poll skipped: {error}");
    }
}

#[cfg(test)]
mod tests {
    use futures_util::{SinkExt as _, StreamExt as _};
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio::sync::{mpsc, watch};
    use tokio_tungstenite::tungstenite::Message;

    use super::*;

    #[test]
    fn websocket_url_preserves_the_versioned_api_base_and_cursor() {
        assert_eq!(
            remote_websocket_url("https://sync.example/api/v1", "mac id", "17-4")
                .expect("WebSocket URL"),
            "wss://sync.example/api/v1/remote/devices/mac%20id/ws?lastId=17-4"
        );
        assert!(
            remote_websocket_url("ftp://sync.example/api/v1", "mac-1", "0")
                .expect_err("unsupported schemes should fail")
                .to_string()
                .contains("does not support ftp URLs")
        );
    }

    #[test]
    fn websocket_envelope_defaults_a_missing_cursor() {
        let envelope: RemoteWebSocketEnvelope = serde_json::from_value(json!({
            "type": "commands",
            "commands": []
        }))
        .expect("command envelope");
        assert_eq!(envelope.last_id, "0");
    }

    #[test]
    fn mobile_remote_can_select_and_clear_projects_but_not_mutate_them() {
        assert!(mobile_rpc_method_allowed(Some("project.use")));
        assert!(mobile_rpc_method_allowed(Some("project.clear")));
        assert!(!mobile_rpc_method_allowed(Some("project.create")));
        assert!(!mobile_rpc_method_allowed(Some("project.delete")));
    }

    #[tokio::test]
    async fn websocket_batches_require_the_current_remote_session_and_ack_the_cursor() {
        let mut runtime = AppRuntime::new(crate::runtime::RuntimeConfig::default());
        runtime
            .set_metadata_value("remote_allow_connections", "true")
            .expect("Remote should enable");
        runtime
            .set_auth_token(Some("token-1"))
            .expect("Remote token should persist");
        let mut connection = stdio::ConnectionState::default();
        let (interaction_output, _interaction_rx) = mpsc::channel(1);
        let broker = InteractionBroker::new(interaction_output);
        let backlog = VecDeque::new();

        let stale = process_remote_websocket_batch(
            &mut runtime,
            &mut connection,
            &broker,
            &backlog,
            RemoteWebSocketBatch {
                token: "stale-token".to_string(),
                poll: ApiRemoteCommandPoll {
                    commands: Vec::new(),
                    last_id: "stale-cursor".to_string(),
                },
            },
        )
        .await
        .expect("stale batch should be ignored");
        assert!(stale.0.is_empty());
        assert!(stale.1.is_empty());

        let (results, notifications) = process_remote_websocket_batch(
            &mut runtime,
            &mut connection,
            &broker,
            &backlog,
            RemoteWebSocketBatch {
                token: "token-1".to_string(),
                poll: ApiRemoteCommandPoll {
                    commands: vec![ApiRemoteCommand {
                        id: "command-1".to_string(),
                        controller_device_id: "phone-1".to_string(),
                        request: json!({
                            "jsonrpc": "2.0",
                            "id": 8,
                            "method": "server.ping"
                        }),
                    }],
                    last_id: "10-0".to_string(),
                },
            },
        )
        .await
        .expect("current batch should execute");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].command_id, "command-1");
        assert_eq!(results[0].last_id.as_deref(), Some("10-0"));
        assert!(notifications.is_empty());
    }

    #[tokio::test]
    #[allow(clippy::result_large_err)] // tungstenite's server handshake callback owns this signature.
    async fn websocket_transport_authenticates_receives_commands_and_returns_results() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("WebSocket fixture should bind");
        let address = listener.local_addr().expect("fixture address");
        let fixture = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("client should connect");
            let mut socket = tokio_tungstenite::accept_hdr_async(
                stream,
                |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
                 response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    assert_eq!(
                        request.uri().path_and_query().map(ToString::to_string),
                        Some("/api/v1/remote/devices/mac-1/ws?lastId=9-0".to_string())
                    );
                    assert_eq!(
                        request.headers().get(AUTHORIZATION).and_then(|value| value.to_str().ok()),
                        Some("Bearer token-1")
                    );
                    assert_eq!(
                        request.headers().get("X-Device-Id").and_then(|value| value.to_str().ok()),
                        Some("mac-1")
                    );
                    assert_eq!(
                        request.headers().get("X-Device-Credential").and_then(|value| value.to_str().ok()),
                        Some("credential-1")
                    );
                    Ok(response)
                },
            )
            .await
            .expect("WebSocket upgrade should succeed");
            socket
                .send(Message::Ping(b"heartbeat".to_vec().into()))
                .await
                .expect("ping should send");
            loop {
                let message = socket
                    .next()
                    .await
                    .expect("pong frame")
                    .expect("valid pong frame");
                if matches!(message, Message::Pong(payload) if payload.as_ref() == b"heartbeat") {
                    break;
                }
            }
            socket
                .send(Message::Text(
                    json!({
                        "type": "commands",
                        "lastId": "10-0",
                        "commands": [{
                            "id": "command-1",
                            "controllerDeviceId": "phone-1",
                            "request": {"jsonrpc": "2.0", "id": 8, "method": "server.ping"}
                        }]
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .expect("command should send");
            loop {
                let message = socket
                    .next()
                    .await
                    .expect("result frame")
                    .expect("valid frame");
                if let Message::Text(payload) = message {
                    let value: Value = serde_json::from_str(&payload).expect("result JSON");
                    assert_eq!(value["type"], "result");
                    assert_eq!(value["commandId"], "command-1");
                    assert_eq!(value["controllerDeviceId"], "phone-1");
                    assert_eq!(value["response"]["result"]["ok"], true);
                    assert_eq!(value["lastId"], "10-0");
                    socket
                        .send(Message::Text(
                            json!({
                                "type": "resultAck",
                                "commandId": "command-1",
                                "lastId": "10-0"
                            })
                            .to_string()
                            .into(),
                        ))
                        .await
                        .expect("result acknowledgement should send");
                    socket
                        .send(Message::Close(None))
                        .await
                        .expect("close should send");
                    break;
                }
            }
        });

        let request = RemotePollRequest {
            api_client: ApiClient::new(format!("http://{address}/api/v1")),
            token: "token-1".to_string(),
            device_id: "mac-1".to_string(),
            device_credential: "credential-1".to_string(),
            last_id: "9-0".to_string(),
        };
        let (events_tx, mut events_rx) = mpsc::channel(4);
        let (results_tx, results_rx) = mpsc::channel(4);
        let (stop_tx, stop_rx) = watch::channel(false);
        let transport = tokio::spawn(request.run_websocket(events_tx, results_rx, stop_rx));

        assert!(matches!(
            events_rx.recv().await,
            Some(RemoteWebSocketEvent::Connected)
        ));
        let Some(RemoteWebSocketEvent::Commands(batch)) = events_rx.recv().await else {
            panic!("expected a command batch");
        };
        assert_eq!(batch.poll.last_id, "10-0");
        assert_eq!(batch.poll.commands.len(), 1);
        results_tx
            .send(RemoteCommandResult {
                kind: "result",
                command_id: "command-1".to_string(),
                controller_device_id: "phone-1".to_string(),
                response: json!({"jsonrpc": "2.0", "id": 8, "result": {"ok": true}}),
                last_id: Some("10-0".to_string()),
            })
            .await
            .expect("result should queue");

        let Some(RemoteWebSocketEvent::CursorAcknowledged { token, last_id }) =
            events_rx.recv().await
        else {
            panic!("expected a result acknowledgement");
        };
        assert_eq!(token, "token-1");
        assert_eq!(last_id, "10-0");

        fixture.await.expect("fixture should finish");
        let _ = stop_tx.send(true);
        transport.await.expect("transport task should finish");
    }

    #[tokio::test]
    async fn websocket_transport_stops_when_requested() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("WebSocket fixture should bind");
        let address = listener.local_addr().expect("fixture address");
        let fixture = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("client should connect");
            let mut socket = tokio_tungstenite::accept_async(stream)
                .await
                .expect("WebSocket upgrade should succeed");
            while let Some(message) = socket.next().await {
                if matches!(message.expect("valid frame"), Message::Close(_)) {
                    return;
                }
            }
            panic!("client should send a close frame");
        });

        let request = RemotePollRequest {
            api_client: ApiClient::new(format!("http://{address}")),
            token: "token-1".to_string(),
            device_id: "mac-1".to_string(),
            device_credential: "credential-1".to_string(),
            last_id: "0".to_string(),
        };
        let (events_tx, mut events_rx) = mpsc::channel(4);
        let (_results_tx, results_rx) = mpsc::channel(1);
        let (stop_tx, stop_rx) = watch::channel(false);
        let transport = tokio::spawn(request.run_websocket(events_tx, results_rx, stop_rx));

        assert!(matches!(
            events_rx.recv().await,
            Some(RemoteWebSocketEvent::Connected)
        ));
        stop_tx.send(true).expect("stop should signal");
        fixture.await.expect("fixture should finish");
        transport.await.expect("transport task should finish");
        assert!(matches!(
            events_rx.recv().await,
            Some(RemoteWebSocketEvent::Disconnected(_))
        ));
    }
}
