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
        AppServerEvent::TurnStarted { thread_id, turn } => {
            messages.push(notification(
                "turn/started",
                json!({
                    "threadId": thread_id,
                    "turn": turn,
                }),
            ));
            for item in &turn.items {
                messages.push(item_notification(
                    "item/completed",
                    thread_id,
                    &turn.id,
                    item,
                ));
            }
        }
        AppServerEvent::TurnInterrupted { thread_id, turn } => {
            messages.push(notification(
                "turn/interrupted",
                json!({
                    "threadId": thread_id,
                    "turn": turn,
                }),
            ));
        }
        AppServerEvent::TurnUpdated { thread_id, turn } => messages.push(notification(
            "turn/updated",
            json!({"threadId": thread_id, "turn": turn}),
        )),
        AppServerEvent::TurnCompleted { thread_id, turn } => messages.push(notification(
            "turn/completed",
            json!({"threadId": thread_id, "turn": turn}),
        )),
        AppServerEvent::ItemStarted {
            thread_id,
            turn_id,
            item,
        } => messages.push(item_notification("item/started", thread_id, turn_id, item)),
        AppServerEvent::ItemUpdated {
            thread_id,
            turn_id,
            item,
        } => messages.push(item_notification("item/updated", thread_id, turn_id, item)),
        AppServerEvent::ItemCompleted {
            thread_id,
            turn_id,
            item,
        } => messages.push(item_notification(
            "item/completed",
            thread_id,
            turn_id,
            item,
        )),
        AppServerEvent::ThreadUpdated { thread } => {
            messages.push(notification("thread/updated", json!({"thread": thread})))
        }
        AppServerEvent::RunUpdated { .. } => {}
        AppServerEvent::RunDeleted { .. }
        | AppServerEvent::WorkflowRunUpdated { .. }
        | AppServerEvent::ServerRequest { .. } => {}
    }
}

fn item_notification(
    method: &str,
    thread_id: &str,
    turn_id: &str,
    item: &crate::protocol::ThreadItemRecord,
) -> OutgoingMessage {
    notification(
        method,
        json!({"threadId": thread_id, "turnId": turn_id, "item": item}),
    )
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

    use crate::protocol::{
        AppServerEvent, OutgoingMessage, RunRecord, RunStatus, ThreadItemRecord, ThreadItemStatus,
        ThreadItemType, TurnRecord, TurnStatus,
    };

    use super::extend_event_notifications;

    #[test]
    fn lifecycle_notifications_follow_typed_turn_and_item_events() {
        let mut methods = Vec::new();
        let turn = turn_record("turn-lifecycle");
        let item = turn.items[0].clone();
        for event in [
            AppServerEvent::TurnUpdated {
                thread_id: "thread-lifecycle".to_string(),
                turn: Box::new(turn.clone()),
            },
            AppServerEvent::TurnCompleted {
                thread_id: "thread-lifecycle".to_string(),
                turn: Box::new(turn.clone()),
            },
            AppServerEvent::TurnInterrupted {
                thread_id: "thread-lifecycle".to_string(),
                turn: Box::new(turn.clone()),
            },
            AppServerEvent::ItemCompleted {
                thread_id: "thread-lifecycle".to_string(),
                turn_id: turn.id.clone(),
                item: Box::new(item.clone()),
            },
            AppServerEvent::ItemStarted {
                thread_id: "thread-lifecycle".to_string(),
                turn_id: turn.id.clone(),
                item: Box::new(item.clone()),
            },
            AppServerEvent::ItemUpdated {
                thread_id: "thread-lifecycle".to_string(),
                turn_id: turn.id.clone(),
                item: Box::new(item),
            },
        ] {
            let mut messages = Vec::new();
            extend_event_notifications(&mut messages, event);
            methods.extend(messages.into_iter().filter_map(notification_method));
        }

        assert!(methods.contains(&"event".to_string()));
        assert!(methods.contains(&"turn/updated".to_string()));
        assert!(methods.contains(&"turn/interrupted".to_string()));
        assert!(methods.contains(&"item/completed".to_string()));
    }

    fn notification_method(message: OutgoingMessage) -> Option<String> {
        match message {
            OutgoingMessage::Notification(notification) => Some(notification.method),
            OutgoingMessage::Request(_) | OutgoingMessage::Response(_) => None,
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

    fn turn_record(id: &str) -> TurnRecord {
        TurnRecord {
            id: id.to_string(),
            thread_id: "thread-lifecycle".to_string(),
            run_id: "run-lifecycle".to_string(),
            status: TurnStatus::Completed,
            items: vec![ThreadItemRecord {
                id: format!("{id}:agent"),
                turn_id: id.to_string(),
                item_type: ThreadItemType::AgentMessage,
                status: ThreadItemStatus::Completed,
                content: serde_json::json!({"text": "done"}),
                created_at: 1,
                updated_at: 2,
            }],
            created_at: 1,
            updated_at: 2,
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
                turn: Box::new(turn_record("turn-event-bench")),
            },
            AppServerEvent::RunUpdated {
                run: Box::new(run.clone()),
            },
            AppServerEvent::TurnInterrupted {
                thread_id: "thread-event-bench".to_string(),
                turn: Box::new(turn_record("turn-event-bench")),
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
