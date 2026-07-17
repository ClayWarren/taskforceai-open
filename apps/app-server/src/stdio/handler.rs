use crate::protocol::{AppRequest, JsonRpcRequest, OutgoingMessage, JSONRPC_VERSION};
use crate::runtime::AppRuntime;

use super::dispatch::dispatch;
use super::methods::parse_app_request;
use super::registry::{method_spec, MethodStability};
use super::responses::{
    error_response, ok_response, response_for_notification, runtime_error_response,
};
use super::{ConnectionState, InitializationPhase, ServerAction};

pub(super) async fn handle_line(
    line: &str,
    runtime: &mut AppRuntime,
    connection: &mut ConnectionState,
) -> (Vec<OutgoingMessage>, ServerAction) {
    let request = match serde_json::from_str::<JsonRpcRequest>(line) {
        Ok(request) => request,
        Err(_) => {
            return (
                vec![OutgoingMessage::Response(error_response(
                    None,
                    -32700,
                    "Parse error",
                ))],
                ServerAction::Continue,
            );
        }
    };

    handle_request(request, runtime, connection).await
}

pub(crate) async fn handle_request(
    request: JsonRpcRequest,
    runtime: &mut AppRuntime,
    connection: &mut ConnectionState,
) -> (Vec<OutgoingMessage>, ServerAction) {
    let id = request.response_id();
    let is_notification = request.is_notification();

    if request.jsonrpc.as_deref() != Some(JSONRPC_VERSION) {
        return (
            response_for_notification(
                is_notification,
                error_response(id, -32600, "Invalid Request"),
            ),
            ServerAction::Continue,
        );
    }

    let Some(method) = request.method.as_deref() else {
        return (
            response_for_notification(
                is_notification,
                error_response(id, -32600, "Invalid Request"),
            ),
            ServerAction::Continue,
        );
    };

    if method == "initialized" {
        if !is_notification || connection.phase() != InitializationPhase::AwaitingInitialized {
            return (
                response_for_notification(
                    is_notification,
                    error_response(id, -32600, "Invalid initialization acknowledgement"),
                ),
                ServerAction::Continue,
            );
        }
        connection.finish_initialize();
        return (Vec::new(), ServerAction::Continue);
    }

    if method == "initialize" && connection.phase() != InitializationPhase::New {
        return (
            response_for_notification(
                is_notification,
                error_response(id, -32003, "Already initialized"),
            ),
            ServerAction::Continue,
        );
    }

    if method != "initialize" && connection.phase() != InitializationPhase::Ready {
        return (
            response_for_notification(
                is_notification,
                error_response(id, -32002, "Not initialized"),
            ),
            ServerAction::Continue,
        );
    }

    let spec = method_spec(method);
    if spec.stability == MethodStability::Experimental && !connection.experimental_api() {
        return (
            response_for_notification(
                is_notification,
                error_response(
                    id,
                    -32004,
                    format!(
                        "{} requires experimentalApi capability",
                        spec.canonical_name
                    ),
                ),
            ),
            ServerAction::Continue,
        );
    }

    if matches!(
        spec.canonical_name.as_str(),
        "thread/subscribe" | "thread/unsubscribe"
    ) {
        let params = match serde_json::from_value::<crate::protocol::ThreadIDParams>(request.params)
        {
            Ok(params) => params,
            Err(error) => {
                return (
                    response_for_notification(
                        is_notification,
                        runtime_error_response(
                            id,
                            crate::runtime::RuntimeError::invalid_params(error.to_string()),
                        ),
                    ),
                    ServerAction::Continue,
                );
            }
        };
        if spec.canonical_name == "thread/subscribe" {
            connection.subscribe_thread(&params.thread_id);
        } else {
            connection.unsubscribe_thread(&params.thread_id);
        }
        return (
            response_for_notification(
                is_notification,
                ok_response(id, serde_json::json!({"ok": true})),
            ),
            ServerAction::Continue,
        );
    }

    let app_request = match parse_app_request(method, request.params) {
        Ok(app_request) => app_request,
        Err(err) => {
            return (
                response_for_notification(is_notification, runtime_error_response(id, err)),
                ServerAction::Continue,
            );
        }
    };

    if let AppRequest::Initialize(params) = &app_request {
        connection.begin_initialize(params);
    }

    let auto_subscribe = match &app_request {
        AppRequest::ThreadStart(params) => Some(params.thread_id.clone()),
        AppRequest::ThreadResume(params) => Some(Some(params.thread_id.clone())),
        _ => None,
    };

    let (mut messages, action) = dispatch(app_request, id, is_notification, runtime).await;
    if let Some(requested_thread_id) = auto_subscribe {
        let successful_response = messages.iter().find_map(|message| match message {
            OutgoingMessage::Response(response) if response.error.is_none() => {
                Some(response.result.as_ref())
            }
            _ => None,
        });
        if let Some(result) = successful_response {
            let thread_id = requested_thread_id.or_else(|| {
                result
                    .and_then(|result| result.get("thread"))
                    .and_then(|thread| thread.get("id"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            });
            if let Some(thread_id) = thread_id {
                connection.subscribe_thread(&thread_id);
                if let Some(broker) = runtime.interaction_broker.clone() {
                    messages.extend(broker.replay_messages(&thread_id).await);
                }
            }
        }
    }
    messages.retain(|message| match message {
        OutgoingMessage::Notification(notification) => {
            connection.allows_notification(&notification.method, &notification.params)
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Response(_) => true,
    });
    (messages, action)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeConfig;
    use serde_json::json;
    use std::time::Duration;
    use taskforceai_app_protocol::{
        DynamicToolCallParams, InteractionContext, ServerRequestPayload,
    };
    use tokio::sync::mpsc;

    async fn handle(
        line: &str,
        connection: &mut ConnectionState,
    ) -> (Vec<OutgoingMessage>, ServerAction) {
        let mut runtime = AppRuntime::new(RuntimeConfig::default());
        handle_line(line, &mut runtime, connection).await
    }

    #[tokio::test]
    async fn initialization_state_machine_rejects_invalid_order_and_gates_experimental_calls() {
        let mut connection = ConnectionState::default();
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialized","params":{}}"#,
            &mut connection,
        )
        .await;
        assert_eq!(messages.len(), 1);

        let _ = handle(
            r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"capabilities":{"experimentalApi":false}}}"#,
            &mut connection,
        )
        .await;
        assert!(!connection.experimental_api());
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":3,"method":"initialize","params":{}}"#,
            &mut connection,
        )
        .await;
        assert_eq!(messages.len(), 1);
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":4,"method":"initialized","params":{}}"#,
            &mut connection,
        )
        .await;
        assert_eq!(messages.len(), 1);
        let _ = handle(
            r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
            &mut connection,
        )
        .await;
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":5,"method":"thread/rollback","params":{"threadId":"t","turnId":"u"}}"#,
            &mut connection,
        )
        .await;
        assert_eq!(messages.len(), 1);

        let mut experimental = ConnectionState::default();
        let _ = handle(
            r#"{"jsonrpc":"2.0","id":6,"method":"initialize","params":{"capabilities":{"experimentalApi":true,"optOutNotificationMethods":["event"]}}}"#,
            &mut experimental,
        )
        .await;
        let _ = handle(
            r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
            &mut experimental,
        )
        .await;
        assert!(experimental.experimental_api());
        assert!(experimental.suppresses_notification("event"));
        assert!(!experimental.allows_notification("event", &serde_json::json!({})));
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":8,"method":"thread/subscribe","params":{}}"#,
            &mut experimental,
        )
        .await;
        assert_eq!(messages.len(), 1);
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":9,"method":"thread/subscribe","params":{"threadId":"t"}}"#,
            &mut experimental,
        )
        .await;
        assert_eq!(messages.len(), 1);
        assert!(experimental
            .allows_notification("thread/updated", &serde_json::json!({"threadId": "t"})));
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":10,"method":"thread/unsubscribe","params":{"threadId":"t"}}"#,
            &mut experimental,
        )
        .await;
        assert_eq!(messages.len(), 1);
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":7,"method":"thread/rollback","params":{"threadId":"t","turnId":"u"}}"#,
            &mut experimental,
        )
        .await;
        assert_eq!(messages.len(), 1);
    }

    #[tokio::test]
    async fn thread_start_subscribes_and_replays_pending_interactions() {
        let (output, mut outgoing) = mpsc::channel(8);
        let broker = crate::interactions::InteractionBroker::new(output);
        let mut runtime = AppRuntime::new(RuntimeConfig::default());
        runtime.set_interaction_broker(broker.clone());
        let waiting = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .request(
                        ServerRequestPayload::DynamicToolCall(DynamicToolCallParams {
                            context: InteractionContext {
                                thread_id: "replay-thread".to_string(),
                                turn_id: Some("turn-1".to_string()),
                            },
                            call_id: "call-1".to_string(),
                            namespace: None,
                            tool: "fixture".to_string(),
                            arguments: json!({}),
                        }),
                        Duration::from_secs(5),
                    )
                    .await
            })
        };
        let _ = outgoing.recv().await.expect("initial request");

        let mut connection = ConnectionState::default();
        let _ = handle_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
            &mut runtime,
            &mut connection,
        )
        .await;
        let _ = handle_line(
            r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#,
            &mut runtime,
            &mut connection,
        )
        .await;
        let (messages, _) = handle_line(
            r#"{"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"threadId":"replay-thread"}}"#,
            &mut runtime,
            &mut connection,
        )
        .await;
        assert!(matches!(
            messages.first(),
            Some(OutgoingMessage::Response(_))
        ));
        assert!(matches!(messages.last(), Some(OutgoingMessage::Request(_))));
        assert!(
            !connection.allows_notification("turn/updated", &json!({"threadId": "other-thread"}))
        );

        broker.cancel_all().await;
        assert!(waiting.await.expect("join").is_err());
    }
}
