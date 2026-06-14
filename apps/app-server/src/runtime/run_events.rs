use crate::api::{ApiProject, ApiStreamEvent};
use crate::protocol::{ProjectRecord, RunRecord, RunStatus};
use serde_json::Value;

use super::records::merge_json_records;
use super::util::unix_millis;

pub(crate) fn project_from_api(project: ApiProject) -> ProjectRecord {
    ProjectRecord {
        id: project.id,
        name: project.name,
        description: project.description,
        custom_instructions: project.custom_instructions,
        created_at: project.created_at,
    }
}

pub(crate) fn apply_stream_event_to_run(mut run: RunRecord, event: ApiStreamEvent) -> RunRecord {
    run.updated_at = unix_millis();
    if !event.sources.is_empty() {
        run.sources = merge_json_records(run.sources, event.sources, "url");
    }
    if !event.tool_events.is_empty() {
        run.tool_events = merge_tool_events(run.tool_events, event.tool_events);
    }
    if let Some(tool_event) = event.tool_event {
        run.tool_events = merge_tool_events(run.tool_events, vec![tool_event]);
    }
    if !event.agent_statuses.is_empty() {
        run.agent_statuses = event.agent_statuses;
    }
    if event.pending_approval.is_some() {
        run.pending_approval = event.pending_approval.clone();
    }
    match event.event_type.as_str() {
        "start" => {
            run.status = RunStatus::Processing;
        }
        "progress" => {
            run.status = RunStatus::Processing;
            let chunk = event.chunk.trim_end();
            if !chunk.is_empty() {
                let output = run.output.get_or_insert_with(String::new);
                if !output.is_empty() {
                    output.push('\n');
                }
                output.push_str(chunk);
            }
        }
        "complete" => {
            run.status = RunStatus::Completed;
            let message = event.message.trim();
            if !message.is_empty() {
                run.output = Some(resolve_complete_message(
                    message,
                    &run.agent_statuses,
                    &run.tool_events,
                ));
            }
        }
        "error" => {
            run.status = RunStatus::Failed;
            run.error = Some(event.error);
        }
        _ => {}
    }
    run
}

fn merge_tool_events(mut existing: Vec<Value>, updates: Vec<Value>) -> Vec<Value> {
    for update in updates {
        let key = tool_event_key(&update);
        if let Some(key) = key {
            if let Some(index) = existing
                .iter()
                .position(|event| tool_event_key(event).as_deref() == Some(key.as_str()))
            {
                existing[index] = update;
                continue;
            }
        }
        existing.push(update);
    }
    existing
}

fn tool_event_key(event: &Value) -> Option<String> {
    for field in ["invocationId", "id", "toolCallId", "callId"] {
        if let Some(value) = event.get(field).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(format!("{field}:{value}"));
            }
        }
    }

    let tool_name = event.get("toolName").and_then(Value::as_str)?.trim();
    if tool_name.is_empty() {
        return None;
    }
    let agent_id = event
        .get("agentId")
        .map(Value::to_string)
        .unwrap_or_else(|| "null".to_string());
    let agent_label = event
        .get("agentLabel")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let arguments = event
        .get("arguments")
        .map(Value::to_string)
        .unwrap_or_default();

    Some(format!(
        "composite:{agent_id}:{agent_label}:{tool_name}:{arguments}"
    ))
}

fn resolve_complete_message(
    message: &str,
    agent_statuses: &[Value],
    tool_events: &[Value],
) -> String {
    if !is_non_user_facing_answer(message) {
        return message.to_string();
    }

    longest_agent_result(agent_statuses)
        .or_else(|| tool_evidence_message(tool_events))
        .unwrap_or_else(|| {
            "The agents completed their work, but no final summary was provided.".to_string()
        })
}

fn is_non_user_facing_answer(message: &str) -> bool {
    let normalized = message.trim().to_lowercase();
    normalized.contains("i'm ready to help") && normalized.contains("what can i do for you")
        || normalized.contains("(no summary provided by model)")
        || normalized.starts_with("[received message from ")
        || normalized.contains("team - we've been tasked")
        || normalized.contains("i've added ") && normalized.contains(" tasks to the board")
        || normalized.contains("i'm claiming task ")
}

fn longest_agent_result(agent_statuses: &[Value]) -> Option<String> {
    agent_statuses
        .iter()
        .filter_map(|status| status.get("result").and_then(|result| result.as_str()))
        .map(str::trim)
        .filter(|result| !result.is_empty() && !is_non_user_facing_answer(result))
        .max_by_key(|result| result.len())
        .map(ToString::to_string)
}

fn tool_evidence_message(tool_events: &[Value]) -> Option<String> {
    computer_use_evidence_message(tool_events).or_else(|| search_evidence_message(tool_events))
}

fn computer_use_evidence_message(tool_events: &[Value]) -> Option<String> {
    let computer_events: Vec<&Value> = tool_events
        .iter()
        .filter(|event| tool_name(event) == Some("computer_use") && tool_succeeded(event))
        .collect();
    if computer_events.is_empty() {
        return None;
    }

    let captured_desktop = computer_events.iter().any(|event| {
        event
            .get("image_base64")
            .or_else(|| event.get("imageBase64"))
            .and_then(Value::as_str)
            .is_some_and(|image| !image.trim().is_empty())
    });
    let action_count = computer_events.len();
    let mut message = if action_count == 1 {
        "Computer use completed 1 action".to_string()
    } else {
        format!("Computer use completed {action_count} actions")
    };
    if captured_desktop {
        message.push_str(" and captured the desktop");
    }
    if let Some(action) = computer_events.iter().rev().find_map(|event| {
        event
            .get("arguments")
            .and_then(describe_tool_arguments)
            .filter(|action| !action.is_empty())
    }) {
        message.push_str("; latest action: ");
        message.push_str(&action);
    }
    message.push('.');
    Some(message)
}

fn search_evidence_message(tool_events: &[Value]) -> Option<String> {
    let mut titles = Vec::new();
    for event in tool_events {
        if tool_name(event) != Some("search_web") || !tool_succeeded(event) {
            continue;
        }
        let Some(sources) = event.get("sources").and_then(Value::as_array) else {
            continue;
        };
        for source in sources {
            let Some(title) = source
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
            else {
                continue;
            };
            if !titles.iter().any(|seen| seen == title) {
                titles.push(title.to_string());
            }
            if titles.len() >= 3 {
                break;
            }
        }
        if titles.len() >= 3 {
            break;
        }
    }

    if titles.is_empty() {
        None
    } else {
        Some(format!(
            "The agents completed web research; collected sources include {}.",
            titles.join(", ")
        ))
    }
}

fn tool_name(event: &Value) -> Option<&str> {
    event.get("toolName").and_then(Value::as_str)
}

fn tool_succeeded(event: &Value) -> bool {
    event
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            event
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| matches!(status, "completed" | "success"))
        })
}

fn describe_tool_arguments(arguments: &Value) -> Option<String> {
    match arguments {
        Value::String(value) => Some(value.trim().to_string()).filter(|value| !value.is_empty()),
        Value::Object(map) => {
            let action = map
                .get("action")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("computer action");
            let mut description = action.to_string();
            if let Some(text) = map
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                description.push_str(" \"");
                description.push_str(text);
                description.push('"');
            }
            Some(description)
        }
        _ => None,
    }
}
