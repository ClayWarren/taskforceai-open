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
        let events = event_backlog
            .iter()
            .filter(|message| connection.allows_outgoing_message(message))
            .cloned()
            .collect::<VecDeque<_>>();
        return Ok(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request_value.get("id").cloned().unwrap_or(Value::Null),
            "result": { "events": events }
        }));
    }
    if method == "remote.interaction.respond" {
        return Ok(remote_interaction_response(request_value, interaction_broker).await);
    }

    let request: JsonRpcRequest = serde_json::from_value(request_value.clone())
        .map_err(|error| RuntimeError::invalid_params(error.to_string()))?;
    if !mobile_rpc_workspace_request_allowed(connection, &request) {
        return Ok(json!({
            "jsonrpc": JSONRPC_VERSION,
            "id": request.response_id().unwrap_or(Value::Null),
            "error": {
                "code": -32602,
                "message": "workspace is not authorized for this mobile session"
            }
        }));
    }
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
    method.is_some_and(|method| crate::stdio::method_spec(method).mobile_allowed)
}

pub(crate) fn mobile_rpc_workspace_request_allowed(
    connection: &stdio::ConnectionState,
    request: &JsonRpcRequest,
) -> bool {
    let method = request
        .method
        .as_deref()
        .map(stdio::legacy_method_name)
        .unwrap_or_default();
    match method.as_str() {
        "workspace.file.list" | "workspace.file.read" => request_workspace(request)
            .is_some_and(|workspace| connection.allows_mobile_workspace(workspace)),
        "git.review.status"
        | "git.review.diff"
        | "git.review.stage"
        | "git.review.comment.list"
        | "git.review.comment.add"
        | "git.review.pullRequest.action"
        | "git.branch.list"
        | "git.branch.checkout"
        | "git.branch.create"
        | "git.worktree.list"
        | "git.repository.commit"
        | "git.repository.pull"
        | "git.repository.push"
        | "git.pullRequest.create" => mobile_git_workspace_allowed(connection, request),
        "git.worktree.create" => {
            mobile_git_workspace_allowed(connection, request)
                && request
                    .params
                    .get("path")
                    .and_then(Value::as_str)
                    .is_some_and(|path| connection.allows_mobile_workspace_path(path))
        }
        "git.repository.clone" => request
            .params
            .get("destination")
            .and_then(Value::as_str)
            .is_some_and(|path| connection.allows_mobile_workspace_path(path)),
        "project.create" | "project.workspace.set" => {
            let workspace_roots = request
                .params
                .get("workspaceRoots")
                .or_else(|| request.params.get("workspace_roots"));
            workspace_roots.is_none_or(|roots| {
                roots.as_array().is_some_and(|roots| {
                    let roots = roots.iter().map(Value::as_str).collect::<Option<Vec<_>>>();
                    roots.is_some_and(|roots| connection.allows_mobile_workspace_roots(roots))
                })
            })
        }
        "turn.start" | "thread.list" => optional_workspace_allowed(
            connection,
            request
                .params
                .get("workspaceRoot")
                .or_else(|| request.params.get("workspace_root")),
        ),
        "thread.start" => optional_workspace_allowed(
            connection,
            request.params.get("settings").and_then(|settings| {
                settings
                    .get("workspaceRoot")
                    .or_else(|| settings.get("workspace_root"))
            }),
        ),
        "server.ping"
        | "github.repository.list"
        | "project.list"
        | "project.use"
        | "project.clear"
        | "thread.read"
        | "thread.turns.list"
        | "thread.items.list"
        | "thread.children"
        | "thread.status.list"
        | "thread.subscribe"
        | "thread.unsubscribe"
        | "thread.resume"
        | "thread.fork"
        | "thread.archive"
        | "thread.unarchive"
        | "thread.cancel"
        | "thread.delete"
        | "thread.name.set"
        | "turn.steer"
        | "turn.interrupt"
        | "thread.compact"
        | "thread.compact.start"
        | "git.review.comment.resolve"
        | "remote.event.snapshot"
        | "remote.interaction.respond"
        | "pendingChange.list"
        | "run.status"
        | "run.search"
        | "run.cancel" => true,
        _ => false,
    }
}

fn request_workspace(request: &JsonRpcRequest) -> Option<&str> {
    request.params.get("workspace").and_then(Value::as_str)
}

fn mobile_git_workspace_allowed(
    connection: &stdio::ConnectionState,
    request: &JsonRpcRequest,
) -> bool {
    let Some(workspace) = request_workspace(request) else {
        return false;
    };
    if !connection.allows_mobile_workspace(workspace) {
        return false;
    }
    match crate::runtime::mobile_git_repository_root(workspace) {
        Ok(Some(repository_root)) => {
            connection.allows_mobile_workspace(&repository_root.display().to_string())
        }
        Ok(None) => true,
        Err(_) => false,
    }
}

fn optional_workspace_allowed(
    connection: &stdio::ConnectionState,
    workspace: Option<&Value>,
) -> bool {
    workspace.is_none_or(|workspace| {
        workspace
            .as_str()
            .is_some_and(|workspace| connection.allows_mobile_workspace(workspace))
    })
}

pub(crate) fn report_remote_poll_result(result: Result<(), RuntimeError>) {
    if let Err(error) = result {
        log::debug!(target: "remote", "Remote command poll skipped: {error}");
    }
}

#[cfg(test)]
mod tests;
