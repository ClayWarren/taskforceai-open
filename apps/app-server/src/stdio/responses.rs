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
        AppServerEvent::ItemDelta {
            thread_id,
            turn_id,
            item_id,
            item_type,
            field,
            delta,
        } => {
            let method = match item_type {
                crate::protocol::ThreadItemType::AgentMessage => "item/agentMessage/delta",
                crate::protocol::ThreadItemType::Reasoning => "item/reasoning/delta",
                crate::protocol::ThreadItemType::CommandExecution => {
                    "item/commandExecution/outputDelta"
                }
                crate::protocol::ThreadItemType::FileChange => "item/fileChange/delta",
                _ => "item/delta",
            };
            messages.push(notification(
                method,
                json!({
                    "threadId": thread_id,
                    "turnId": turn_id,
                    "itemId": item_id,
                    "itemType": item_type,
                    "field": field,
                    "delta": delta,
                }),
            ));
        }
        AppServerEvent::PlanUpdated {
            thread_id,
            turn_id,
            item_id,
            plan,
        } => messages.push(notification(
            "turn/plan/updated",
            json!({
                "threadId": thread_id,
                "turnId": turn_id,
                "itemId": item_id,
                "plan": plan,
            }),
        )),
        AppServerEvent::ThreadUpdated { thread } => {
            messages.push(notification("thread/updated", json!({"thread": thread})))
        }
        AppServerEvent::ThreadTokenUsageUpdated { thread_id, usage } => {
            messages.push(notification(
                "thread/tokenUsage/updated",
                json!({"threadId": thread_id, "usage": usage}),
            ))
        }
        AppServerEvent::TurnDiffUpdated {
            thread_id,
            turn_id,
            diff,
        } => messages.push(notification(
            "turn/diff/updated",
            json!({"threadId": thread_id, "turnId": turn_id, "diff": diff}),
        )),
        AppServerEvent::ProcessOutputDelta {
            process_id,
            delta,
            cursor,
        } => messages.push(notification(
            "process/outputDelta",
            json!({"processId": process_id, "delta": delta, "cursor": cursor}),
        )),
        AppServerEvent::ProcessExited { process } => {
            messages.push(notification("process/exited", json!({"process": process})))
        }
        AppServerEvent::FsChanged {
            watch_id,
            workspace_root,
            paths,
        } => messages.push(notification(
            "fs/changed",
            json!({"watchId": watch_id, "workspaceRoot": workspace_root, "paths": paths}),
        )),
        AppServerEvent::HookCompleted { result } => {
            messages.push(notification("hook/completed", json!({"result": result})))
        }
        AppServerEvent::ConfigReloaded { revision } => messages.push(notification(
            "config/reloaded",
            json!({"revision": revision}),
        )),
        AppServerEvent::McpStartupStatusUpdated { status } => messages.push(notification(
            "mcpServer/startupStatus/updated",
            json!({"status": status}),
        )),
        AppServerEvent::McpOAuthCompleted { status } => messages.push(notification(
            "mcpServer/oauthLogin/completed",
            json!({"status": status}),
        )),
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

pub(super) fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
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
        AppServerEvent, HookEvent, HookExecutionResult, McpInspectResult, McpServerRecord,
        OutgoingMessage, ProcessRecord, ProcessStatus, RunRecord, RunStatus, ThreadItemRecord,
        ThreadItemStatus, ThreadItemType, TokenUsage, TurnRecord, TurnStatus,
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
            AppServerEvent::ItemDelta {
                thread_id: "thread-lifecycle".to_string(),
                turn_id: turn.id.clone(),
                item_id: "item-lifecycle".to_string(),
                item_type: ThreadItemType::AgentMessage,
                field: "text".to_string(),
                delta: "hello".to_string(),
            },
            AppServerEvent::PlanUpdated {
                thread_id: "thread-lifecycle".to_string(),
                turn_id: turn.id.clone(),
                item_id: "plan-lifecycle".to_string(),
                plan: serde_json::json!({"steps": []}),
            },
            AppServerEvent::McpStartupStatusUpdated {
                status: Box::new(mcp_status()),
            },
            AppServerEvent::McpOAuthCompleted {
                status: Box::new(mcp_status()),
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
        assert!(methods.contains(&"item/agentMessage/delta".to_string()));
        assert!(methods.contains(&"turn/plan/updated".to_string()));
        assert!(methods.contains(&"mcpServer/startupStatus/updated".to_string()));
        assert!(methods.contains(&"mcpServer/oauthLogin/completed".to_string()));
    }

    #[test]
    fn compatibility_events_publish_named_notifications() {
        let process = ProcessRecord {
            id: "process-one".to_string(),
            command: "true".to_string(),
            args: Vec::new(),
            cwd: "/tmp".to_string(),
            workspace_root: "/tmp".to_string(),
            status: ProcessStatus::Exited,
            exit_code: Some(0),
            started_at: 1,
            updated_at: 2,
            output_cursor: 4,
        };
        let events = [
            AppServerEvent::ThreadTokenUsageUpdated {
                thread_id: "thread-one".to_string(),
                usage: TokenUsage::default(),
            },
            AppServerEvent::TurnDiffUpdated {
                thread_id: "thread-one".to_string(),
                turn_id: "turn-one".to_string(),
                diff: "diff".to_string(),
            },
            AppServerEvent::ProcessOutputDelta {
                process_id: "process-one".to_string(),
                delta: "data".to_string(),
                cursor: 4,
            },
            AppServerEvent::ProcessExited { process },
            AppServerEvent::FsChanged {
                watch_id: "watch-one".to_string(),
                workspace_root: "/tmp".to_string(),
                paths: vec!["file.rs".to_string()],
            },
            AppServerEvent::HookCompleted {
                result: HookExecutionResult {
                    hook_id: "hook-one".to_string(),
                    event: HookEvent::AfterTurnStart,
                    success: true,
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                    duration_ms: 1,
                },
            },
            AppServerEvent::ConfigReloaded {
                revision: "revision".to_string(),
            },
        ];
        let mut methods = Vec::new();
        for event in events {
            let mut messages = Vec::new();
            extend_event_notifications(&mut messages, event);
            methods.extend(messages.into_iter().filter_map(notification_method));
        }
        for method in [
            "thread/tokenUsage/updated",
            "turn/diff/updated",
            "process/outputDelta",
            "process/exited",
            "fs/changed",
            "hook/completed",
            "config/reloaded",
        ] {
            assert!(methods.contains(&method.to_string()), "missing {method}");
        }
    }

    fn mcp_status() -> McpInspectResult {
        McpInspectResult {
            server: McpServerRecord {
                name: "docs".to_string(),
                endpoint: "https://example.test/mcp".to_string(),
                tools: Vec::new(),
                enabled: true,
            },
            transport: "streamable_http".to_string(),
            command: None,
            args: Vec::new(),
            adapter_ready: false,
            status: "configured".to_string(),
            auth_required: false,
            oauth_supported: true,
            message: "configured".to_string(),
        }
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
