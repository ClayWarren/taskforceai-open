use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use taskforceai_app_protocol::{
    JsonRpcError, JsonRpcNotification, JsonRpcResponse, JsonRpcServerRequest, OutgoingMessage,
    ServerRequestPayload, ServerRequestResolvedParams, JSONRPC_VERSION,
};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug, Error)]
pub(crate) enum InteractionError {
    #[error("client interaction transport is closed")]
    TransportClosed,
    #[error("client interaction timed out")]
    Timeout,
    #[error("client rejected interaction with {code}: {message}")]
    Client { code: i64, message: String },
    #[error("encode client interaction: {0}")]
    Encode(serde_json::Error),
    #[error("client interaction was canceled")]
    Canceled,
}

#[derive(Debug)]
struct PendingInteraction {
    thread_id: String,
    turn_id: Option<String>,
    response: oneshot::Sender<Result<Value, JsonRpcError>>,
}

#[derive(Debug, Clone)]
pub(crate) struct InteractionBroker {
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, PendingInteraction>>>,
    output: mpsc::Sender<OutgoingMessage>,
}

impl InteractionBroker {
    pub(crate) fn new(output: mpsc::Sender<OutgoingMessage>) -> Self {
        Self {
            next_id: Arc::new(AtomicU64::new(1)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            output,
        }
    }

    pub(crate) async fn request(
        &self,
        payload: ServerRequestPayload,
        timeout: Duration,
    ) -> Result<Value, InteractionError> {
        let method = payload.method().to_string();
        let context = payload.context().clone();
        let params = payload.into_params().map_err(InteractionError::Encode)?;
        let request_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (response, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            request_id,
            PendingInteraction {
                thread_id: context.thread_id,
                turn_id: context.turn_id,
                response,
            },
        );
        let request = OutgoingMessage::Request(JsonRpcServerRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: json!(request_id),
            method,
            params,
        });
        if self.output.send(request).await.is_err() {
            self.pending.lock().await.remove(&request_id);
            return Err(InteractionError::TransportClosed);
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(error))) => Err(InteractionError::Client {
                code: error.code,
                message: error.message,
            }),
            Ok(Err(_)) => Err(InteractionError::Canceled),
            Err(_) => {
                if let Some(pending) = self.pending.lock().await.remove(&request_id) {
                    self.emit_resolved(request_id, &pending.thread_id).await;
                }
                Err(InteractionError::Timeout)
            }
        }
    }

    pub(crate) async fn resolve(&self, response: JsonRpcResponse) -> bool {
        let Some(request_id) = response.id.as_ref().and_then(Value::as_u64) else {
            return false;
        };
        let Some(pending) = self.pending.lock().await.remove(&request_id) else {
            return false;
        };
        let result = match response.error {
            Some(error) => Err(error),
            None => response.result.ok_or(JsonRpcError {
                code: -32603,
                message: "Missing interaction result".to_string(),
                data: None,
            }),
        };
        let _ = pending.response.send(result);
        self.emit_resolved(request_id, &pending.thread_id).await;
        true
    }

    pub(crate) async fn cancel_thread(&self, thread_id: &str) -> usize {
        self.cancel_matching(|pending| pending.thread_id == thread_id)
            .await
    }

    pub(crate) async fn cancel_turn(&self, thread_id: &str, turn_id: &str) -> usize {
        self.cancel_matching(|pending| {
            pending.thread_id == thread_id && pending.turn_id.as_deref() == Some(turn_id)
        })
        .await
    }

    pub(crate) async fn cancel_all(&self) -> usize {
        self.cancel_matching(|_| true).await
    }

    async fn cancel_matching(&self, predicate: impl Fn(&PendingInteraction) -> bool) -> usize {
        let removed = {
            let mut pending = self.pending.lock().await;
            let ids = pending
                .iter()
                .filter_map(|(id, interaction)| predicate(interaction).then_some(*id))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|interaction| (id, interaction)))
                .collect::<Vec<_>>()
        };
        let count = removed.len();
        for (request_id, interaction) in removed {
            drop(interaction.response);
            self.emit_resolved(request_id, &interaction.thread_id).await;
        }
        count
    }

    async fn emit_resolved(&self, request_id: u64, thread_id: &str) {
        let params = ServerRequestResolvedParams {
            thread_id: thread_id.to_string(),
            request_id,
        };
        let _ = self
            .output
            .send(OutgoingMessage::Notification(JsonRpcNotification {
                jsonrpc: JSONRPC_VERSION.to_string(),
                method: "serverRequest/resolved".to_string(),
                params: serde_json::to_value(params).unwrap_or(Value::Null),
            }))
            .await;
    }

    #[cfg(test)]
    pub(crate) async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use taskforceai_app_protocol::{DynamicToolCallParams, InteractionContext};

    fn tool_request(thread_id: &str, turn_id: &str) -> ServerRequestPayload {
        ServerRequestPayload::DynamicToolCall(DynamicToolCallParams {
            context: InteractionContext {
                thread_id: thread_id.to_string(),
                turn_id: Some(turn_id.to_string()),
            },
            call_id: "call-1".to_string(),
            namespace: Some("browser".to_string()),
            tool: "navigate".to_string(),
            arguments: json!({"url": "https://example.com"}),
        })
    }

    #[tokio::test]
    async fn request_resolves_by_id_and_emits_lifecycle_notification() {
        let (output, mut messages) = mpsc::channel(8);
        let broker = InteractionBroker::new(output);
        let waiting = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .request(tool_request("thread-1", "turn-1"), Duration::from_secs(1))
                    .await
            })
        };
        let OutgoingMessage::Request(request) = messages.recv().await.expect("request") else {
            panic!("expected request");
        };
        assert_eq!(request.method, "item/tool/call");
        assert_eq!(request.params["threadId"], "thread-1");
        assert!(
            broker
                .resolve(JsonRpcResponse {
                    jsonrpc: JSONRPC_VERSION.to_string(),
                    id: Some(request.id),
                    result: Some(json!({"success": true})),
                    error: None,
                })
                .await
        );
        assert_eq!(
            waiting.await.expect("join").expect("response")["success"],
            true
        );
        let OutgoingMessage::Notification(resolved) = messages.recv().await.expect("resolved")
        else {
            panic!("expected resolved notification");
        };
        assert_eq!(resolved.method, "serverRequest/resolved");
        assert_eq!(resolved.params["threadId"], "thread-1");
    }

    #[tokio::test]
    async fn cancellation_clears_only_matching_turn_requests() {
        let (output, mut messages) = mpsc::channel(8);
        let broker = InteractionBroker::new(output);
        let first = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .request(tool_request("thread-1", "turn-1"), Duration::from_secs(5))
                    .await
            })
        };
        let second = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .request(tool_request("thread-1", "turn-2"), Duration::from_secs(5))
                    .await
            })
        };
        let _ = messages.recv().await;
        let _ = messages.recv().await;
        assert_eq!(broker.cancel_turn("thread-1", "turn-1").await, 1);
        assert!(matches!(
            first.await.expect("join"),
            Err(InteractionError::Canceled)
        ));
        assert_eq!(broker.pending_count().await, 1);
        assert_eq!(broker.cancel_thread("thread-1").await, 1);
        assert!(matches!(
            second.await.expect("join"),
            Err(InteractionError::Canceled)
        ));
    }

    #[tokio::test]
    async fn request_reports_closed_timeout_and_client_error_paths() {
        let (closed_output, closed_messages) = mpsc::channel(1);
        drop(closed_messages);
        let closed = InteractionBroker::new(closed_output);
        assert!(matches!(
            closed
                .request(tool_request("closed", "turn"), Duration::from_millis(1))
                .await,
            Err(InteractionError::TransportClosed)
        ));

        let (output, mut messages) = mpsc::channel(8);
        let broker = InteractionBroker::new(output);
        let timed_out = broker
            .request(tool_request("timeout", "turn"), Duration::from_millis(1))
            .await;
        assert!(matches!(timed_out, Err(InteractionError::Timeout)));
        assert!(matches!(
            messages.recv().await,
            Some(OutgoingMessage::Request(_))
        ));
        assert!(matches!(
            messages.recv().await,
            Some(OutgoingMessage::Notification(_))
        ));

        let waiting = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .request(tool_request("error", "turn"), Duration::from_secs(1))
                    .await
            })
        };
        let OutgoingMessage::Request(request) = messages.recv().await.expect("request") else {
            panic!("expected request");
        };
        assert!(
            broker
                .resolve(JsonRpcResponse {
                    jsonrpc: JSONRPC_VERSION.to_string(),
                    id: Some(request.id),
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32001,
                        message: "declined".into(),
                        data: None,
                    }),
                })
                .await
        );
        assert!(matches!(
            waiting.await.expect("join"),
            Err(InteractionError::Client { code: -32001, .. })
        ));
        let _ = messages.recv().await;
        assert!(
            !broker
                .resolve(JsonRpcResponse {
                    jsonrpc: JSONRPC_VERSION.to_string(),
                    id: Some(json!(999)),
                    result: Some(json!({})),
                    error: None,
                })
                .await
        );
        assert!(
            !broker
                .resolve(JsonRpcResponse {
                    jsonrpc: JSONRPC_VERSION.to_string(),
                    id: Some(json!("bad")),
                    result: Some(json!({})),
                    error: None,
                })
                .await
        );
        assert_eq!(broker.cancel_all().await, 0);
    }
}
