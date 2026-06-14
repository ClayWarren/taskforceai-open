use serde_json::{json, Value};

use crate::protocol::{
    AppServerEvent, JsonRpcError, JsonRpcNotification, JsonRpcResponse, OutgoingMessage,
    JSONRPC_VERSION,
};
use crate::runtime::RuntimeError;

pub(super) fn messages_for_success(
    id: Option<Value>,
    is_notification: bool,
    result: Value,
    events: Vec<AppServerEvent>,
) -> Vec<OutgoingMessage> {
    let mut messages = response_for_notification(is_notification, ok_response(id, result));
    messages.extend(events.into_iter().flat_map(event_notifications));
    messages
}

pub(crate) fn event_notifications(event: AppServerEvent) -> Vec<OutgoingMessage> {
    let mut messages = vec![notification(
        "event",
        serde_json::to_value(&event).expect("event serialization should not fail"),
    )];
    messages.extend(lifecycle_notifications(&event));
    messages
}

fn lifecycle_notifications(event: &AppServerEvent) -> Vec<OutgoingMessage> {
    match event {
        AppServerEvent::TurnStarted { thread_id, run } => vec![
            notification(
                "turn/started",
                json!({
                    "threadId": thread_id,
                    "run": run,
                }),
            ),
            notification(
                "item/started",
                json!({
                    "threadId": thread_id,
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ),
        ],
        AppServerEvent::TurnInterrupted { thread_id, run } => vec![
            notification(
                "turn/interrupted",
                json!({
                    "threadId": thread_id,
                    "run": run,
                }),
            ),
            notification(
                "item/completed",
                json!({
                    "threadId": thread_id,
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ),
        ],
        AppServerEvent::RunUpdated { run } => run_lifecycle_notifications(run),
        AppServerEvent::RunDeleted { .. } | AppServerEvent::WorkflowRunUpdated { .. } => Vec::new(),
    }
}

fn run_lifecycle_notifications(run: &crate::protocol::RunRecord) -> Vec<OutgoingMessage> {
    match run.status {
        crate::protocol::RunStatus::Processing => vec![notification(
            "turn/updated",
            json!({
                "run": run,
            }),
        )],
        crate::protocol::RunStatus::Completed => vec![
            notification(
                "turn/completed",
                json!({
                    "run": run,
                }),
            ),
            notification(
                "item/completed",
                json!({
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ),
        ],
        crate::protocol::RunStatus::Failed => vec![
            notification(
                "turn/failed",
                json!({
                    "run": run,
                }),
            ),
            notification(
                "item/completed",
                json!({
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ),
        ],
        crate::protocol::RunStatus::Canceled => vec![notification(
            "turn/interrupted",
            json!({
                "run": run,
            }),
        )],
        crate::protocol::RunStatus::Queued => Vec::new(),
    }
}

fn notification(method: impl Into<String>, params: Value) -> OutgoingMessage {
    OutgoingMessage::Notification(JsonRpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: method.into(),
        params,
    })
}

pub(super) fn response_for_notification(
    is_notification: bool,
    response: JsonRpcResponse,
) -> Vec<OutgoingMessage> {
    if is_notification {
        Vec::new()
    } else {
        vec![OutgoingMessage::Response(response)]
    }
}

fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
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

pub(super) fn runtime_error_response(id: Option<Value>, err: RuntimeError) -> JsonRpcResponse {
    error_response(id, err.code, err.message)
}
