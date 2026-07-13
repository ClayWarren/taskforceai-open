use crate::protocol::{AppRequest, JsonRpcRequest, OutgoingMessage, JSONRPC_VERSION};
use crate::runtime::AppRuntime;

use super::dispatch::dispatch;
use super::methods::parse_app_request;
use super::responses::{error_response, response_for_notification, runtime_error_response};
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

    if matches!(method, "thread.rollback" | "thread/rollback") && !connection.experimental_api() {
        return (
            response_for_notification(
                is_notification,
                error_response(
                    id,
                    -32004,
                    "thread/rollback requires experimentalApi capability",
                ),
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

    let (mut messages, action) = dispatch(app_request, id, is_notification, runtime).await;
    messages.retain(|message| match message {
        OutgoingMessage::Notification(notification) => {
            !connection.suppresses_notification(&notification.method)
        }
        OutgoingMessage::Request(_) | OutgoingMessage::Response(_) => true,
    });
    (messages, action)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RuntimeConfig;

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
        let (messages, _) = handle(
            r#"{"jsonrpc":"2.0","id":7,"method":"thread/rollback","params":{"threadId":"t","turnId":"u"}}"#,
            &mut experimental,
        )
        .await;
        assert_eq!(messages.len(), 1);
    }
}
