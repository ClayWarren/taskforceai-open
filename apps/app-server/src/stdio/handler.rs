use crate::protocol::{JsonRpcRequest, OutgoingMessage, JSONRPC_VERSION};
use crate::runtime::AppRuntime;

use super::dispatch::dispatch;
use super::methods::parse_app_request;
use super::responses::{error_response, response_for_notification, runtime_error_response};
use super::ServerAction;

pub(super) async fn handle_line(
    line: &str,
    runtime: &mut AppRuntime,
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

    handle_request(request, runtime).await
}

pub(crate) async fn handle_request(
    request: JsonRpcRequest,
    runtime: &mut AppRuntime,
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

    let app_request = match parse_app_request(method, request.params) {
        Ok(app_request) => app_request,
        Err(err) => {
            return (
                response_for_notification(is_notification, runtime_error_response(id, err)),
                ServerAction::Continue,
            );
        }
    };

    dispatch(app_request, id, is_notification, runtime).await
}
