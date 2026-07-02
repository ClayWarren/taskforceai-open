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
    messages.reserve(events.len() * 3);
    for event in events {
        extend_event_notifications(&mut messages, event);
    }
    messages
}

pub(crate) fn extend_event_notifications(
    messages: &mut Vec<OutgoingMessage>,
    event: AppServerEvent,
) {
    messages.push(notification(
        "event",
        serde_json::to_value(&event).expect("event serialization should not fail"),
    ));
    push_lifecycle_notifications(messages, &event);
}

fn push_lifecycle_notifications(messages: &mut Vec<OutgoingMessage>, event: &AppServerEvent) {
    match event {
        AppServerEvent::TurnStarted { thread_id, run } => {
            messages.push(notification(
                "turn/started",
                json!({
                    "threadId": thread_id,
                    "run": run,
                }),
            ));
            messages.push(notification(
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
            ));
        }
        AppServerEvent::TurnInterrupted { thread_id, run } => {
            messages.push(notification(
                "turn/interrupted",
                json!({
                    "threadId": thread_id,
                    "run": run,
                }),
            ));
            messages.push(notification(
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
            ));
        }
        AppServerEvent::RunUpdated { run } => push_run_lifecycle_notifications(messages, run),
        AppServerEvent::RunDeleted { .. } | AppServerEvent::WorkflowRunUpdated { .. } => {}
    }
}

fn push_run_lifecycle_notifications(
    messages: &mut Vec<OutgoingMessage>,
    run: &crate::protocol::RunRecord,
) {
    match run.status {
        crate::protocol::RunStatus::Processing => messages.push(notification(
            "turn/updated",
            json!({
                "run": run,
            }),
        )),
        crate::protocol::RunStatus::Completed => {
            messages.push(notification(
                "turn/completed",
                json!({
                    "run": run,
                }),
            ));
            messages.push(notification(
                "item/completed",
                json!({
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ));
        }
        crate::protocol::RunStatus::Failed => {
            messages.push(notification(
                "turn/failed",
                json!({
                    "run": run,
                }),
            ));
            messages.push(notification(
                "item/completed",
                json!({
                    "runId": run.id,
                    "item": {
                        "id": format!("run:{}", run.id),
                        "type": "run",
                        "status": run.status,
                    },
                }),
            ));
        }
        crate::protocol::RunStatus::Canceled => messages.push(notification(
            "turn/interrupted",
            json!({
                "run": run,
            }),
        )),
        crate::protocol::RunStatus::Queued => {}
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

#[cfg(test)]
mod tests {
    use std::{
        hint::black_box,
        time::{Duration, Instant},
    };

    use crate::protocol::{AppServerEvent, OutgoingMessage, RunRecord, RunStatus};

    use super::extend_event_notifications;

    #[test]
    fn lifecycle_notifications_cover_processing_failed_and_canceled_runs() {
        let mut methods = Vec::new();
        for status in [
            RunStatus::Processing,
            RunStatus::Failed,
            RunStatus::Canceled,
            RunStatus::Queued,
        ] {
            let mut run = run_record("run-lifecycle");
            run.status = status;
            let mut messages = Vec::new();
            extend_event_notifications(
                &mut messages,
                AppServerEvent::RunUpdated { run: Box::new(run) },
            );
            methods.extend(messages.into_iter().filter_map(notification_method));
        }

        assert!(methods.contains(&"event".to_string()));
        assert!(methods.contains(&"turn/updated".to_string()));
        assert!(methods.contains(&"turn/failed".to_string()));
        assert!(methods.contains(&"turn/interrupted".to_string()));
        assert!(methods.contains(&"item/completed".to_string()));
    }

    fn notification_method(message: OutgoingMessage) -> Option<String> {
        match message {
            OutgoingMessage::Notification(notification) => Some(notification.method),
            OutgoingMessage::Response(_) => None,
        }
    }

    fn run_record(id: &str) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "Lifecycle notification coverage".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Queued,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 2,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    #[test]
    #[ignore = "prints focused event notification fan-out performance timing"]
    fn bench_event_notification_fanout() {
        let mut run = run_record("run-event-bench");
        run.model_id = Some("gpt-5".to_string());
        run.project_id = Some(42);
        run.status = RunStatus::Completed;
        run.output = Some("completed".to_string());
        let events = vec![
            AppServerEvent::TurnStarted {
                thread_id: "thread-event-bench".to_string(),
                run: Box::new(run.clone()),
            },
            AppServerEvent::RunUpdated {
                run: Box::new(run.clone()),
            },
            AppServerEvent::TurnInterrupted {
                thread_id: "thread-event-bench".to_string(),
                run: Box::new(run.clone()),
            },
            AppServerEvent::RunDeleted {
                run_id: run.id.clone(),
            },
        ];
        const ITERATIONS: u32 = 50_000;

        let elapsed = time_iterations(ITERATIONS, || {
            let events = black_box(events.clone());
            let mut messages = Vec::with_capacity(events.len() * 3);
            for event in events {
                extend_event_notifications(&mut messages, event);
            }
            black_box(messages);
        });

        let events_processed = f64::from(ITERATIONS) * events.len() as f64;
        let ns_per_event = elapsed.as_nanos() as f64 / events_processed;
        println!(
            "bench_event_notification_fanout: {ITERATIONS} batches in {:?} ({ns_per_event:.2} ns/event)",
            elapsed
        );
    }

    fn time_iterations(iterations: u32, mut run: impl FnMut()) -> Duration {
        let start = Instant::now();
        for _ in 0..iterations {
            run();
        }
        start.elapsed()
    }
}
