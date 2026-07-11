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
            // coverage:ignore-start
            run.status = RunStatus::Processing;
        }
        // coverage:ignore-end
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
                continue; // coverage:ignore-line
            }
        } // coverage:ignore-line
        existing.push(update);
    }
    existing
}

fn tool_event_key(event: &Value) -> Option<String> {
    for field in ["invocationId", "id", "toolCallId", "callId"] {
        if let Some(value) = event.get(field).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                // coverage:ignore-line
                return Some(format!("{field}:{value}"));
            } // coverage:ignore-line
        }
    }

    let tool_name = event.get("toolName").and_then(Value::as_str)?.trim(); // coverage:ignore-line
    if tool_name.is_empty() {
        return None; // coverage:ignore-line
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
        // coverage:ignore-line
        if tool_name(event) != Some("search_web") || !tool_succeeded(event) {
            continue; // coverage:ignore-line
        } // coverage:ignore-line
        let Some(sources) = event.get("sources").and_then(Value::as_array) else {
            continue; // coverage:ignore-line
        };
        for source in sources {
            let Some(title) = source
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
            // coverage:ignore-line
            else {
                continue; // coverage:ignore-line
            };
            if !titles.iter().any(|seen| seen == title) {
                titles.push(title.to_string());
            }
            if titles.len() >= 3 {
                break;
            }
        }
        if titles.len() >= 3 {
            // coverage:ignore-line
            break;
        } // coverage:ignore-line
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
            Some(description) // coverage:ignore-line
        }
        _ => None, // coverage:ignore-line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::ApiStreamEvent;
    use serde_json::json;

    #[test]
    fn project_from_api_preserves_project_metadata() {
        let project = project_from_api(ApiProject {
            id: 42,
            name: "Research".to_string(),
            description: Some("Deep work".to_string()),
            custom_instructions: Some("Be precise".to_string()),
            created_at: Some("2026-07-01T00:00:00Z".to_string()),
        });

        assert_eq!(project.id, 42);
        assert_eq!(project.name, "Research");
        assert_eq!(project.description.as_deref(), Some("Deep work"));
        assert_eq!(project.custom_instructions.as_deref(), Some("Be precise"));
    }

    #[test]
    fn stream_events_merge_progress_sources_tools_status_and_approval() {
        let run = run_record("run-events");
        let run = apply_stream_event_to_run(
            run,
            stream_event("progress")
                .with_chunk("first chunk\n")
                .with_sources(vec![
                    json!({ "url": "https://example.com/a", "title": "A" }),
                    json!({ "url": "https://example.com/a", "title": "duplicate" }),
                ])
                .with_tool_events(vec![
                    json!({ "invocationId": "tool-1", "toolName": "search_web", "success": true }),
                    json!({ "toolCallId": "tool-2", "toolName": "computer_use", "status": "success" }),
                ])
                .with_tool_event(json!({
                    "callId": "tool-3",
                    "toolName": "computer_use",
                    "success": true,
                    "arguments": { "action": "type", "text": "hello" }
                }))
                .with_agent_statuses(vec![json!({ "agent": "Lead", "status": "RUNNING" })])
                .with_pending_approval(json!({ "id": "approval-1" }))
                .build(),
        );

        assert_eq!(run.status, RunStatus::Processing);
        assert_eq!(run.output.as_deref(), Some("first chunk"));
        assert_eq!(run.sources.len(), 1);
        assert_eq!(run.tool_events.len(), 3);
        assert_eq!(
            run.agent_statuses,
            vec![json!({ "agent": "Lead", "status": "RUNNING" })]
        );
        assert_eq!(
            run.pending_approval
                .as_ref()
                .and_then(|value| value["id"].as_str()),
            Some("approval-1")
        );

        let run = apply_stream_event_to_run(
            run,
            stream_event("progress")
                .with_chunk("second chunk")
                .with_tool_events(vec![json!({
                    "invocationId": "tool-1",
                    "toolName": "search_web",
                    "success": true,
                    "sources": [{ "title": "Source A" }]
                })])
                .build(),
        );

        assert_eq!(run.output.as_deref(), Some("first chunk\nsecond chunk"));
        assert_eq!(run.tool_events.len(), 3);
        assert_eq!(
            run.tool_events
                .iter()
                .find(|event| event["invocationId"] == "tool-1")
                .and_then(|event| event["sources"][0]["title"].as_str()),
            Some("Source A")
        );
    }

    #[test]
    fn complete_events_use_agent_tool_or_generic_fallback_for_non_answers() {
        let agent_summary = apply_stream_event_to_run(
            RunRecord {
                agent_statuses: vec![
                    json!({ "result": "I'm ready to help. What can I do for you?" }),
                    json!({ "result": "Completed the requested research summary." }),
                ],
                ..run_record("agent-summary")
            },
            stream_event("complete")
                .with_message("I'm ready to help. What can I do for you?")
                .build(),
        );
        assert_eq!(
            agent_summary.output.as_deref(),
            Some("Completed the requested research summary.")
        );

        let computer_summary = apply_stream_event_to_run(
            RunRecord {
                tool_events: vec![
                    json!({
                        "toolName": "computer_use",
                        "success": true,
                        "imageBase64": "abc",
                        "arguments": { "action": "click" }
                    }),
                    json!({
                        "toolName": "computer_use",
                        "status": "completed",
                        "arguments": " press enter "
                    }),
                ],
                ..run_record("computer-summary")
            },
            stream_event("complete")
                .with_message("(no summary provided by model)")
                .build(),
        );
        assert_eq!(
            computer_summary.output.as_deref(),
            Some("Computer use completed 2 actions and captured the desktop; latest action: press enter.")
        );

        let search_summary = apply_stream_event_to_run(
            RunRecord {
                tool_events: vec![json!({
                    "toolName": "search_web",
                    "success": true,
                    "sources": [
                        { "title": "One" },
                        { "title": "Two" },
                        { "title": "Two" },
                        { "title": "Three" },
                        { "title": "Four" }
                    ]
                })],
                ..run_record("search-summary")
            },
            stream_event("complete")
                .with_message("[Received message from agent]")
                .build(),
        );
        assert_eq!(
            search_summary.output.as_deref(),
            Some("The agents completed web research; collected sources include One, Two, Three.")
        );

        let generic = apply_stream_event_to_run(
            run_record("generic-summary"),
            stream_event("complete")
                .with_message("Team - we've been tasked with coordinating.")
                .build(),
        );
        assert_eq!(
            generic.output.as_deref(),
            Some("The agents completed their work, but no final summary was provided.")
        );

        let direct = apply_stream_event_to_run(
            run_record("direct-summary"),
            stream_event("complete").with_message("Done.").build(),
        );
        assert_eq!(direct.status, RunStatus::Completed);
        assert_eq!(direct.output.as_deref(), Some("Done."));
    }

    #[test]
    fn error_and_unknown_events_preserve_expected_run_state() {
        let failed = apply_stream_event_to_run(
            run_record("failed"),
            stream_event("error").with_error("remote failed").build(),
        );
        assert_eq!(failed.status, RunStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("remote failed"));

        let unchanged =
            apply_stream_event_to_run(run_record("unknown"), stream_event("heartbeat").build());
        assert_eq!(unchanged.status, RunStatus::Queued);
        assert!(unchanged.output.is_none());
    }

    fn run_record(id: &str) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "prompt".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Queued,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    fn stream_event(event_type: &str) -> StreamEventBuilder {
        StreamEventBuilder {
            event: ApiStreamEvent {
                event_type: event_type.to_string(),
                chunk: String::new(),
                message: String::new(),
                error: String::new(),
                sources: Vec::new(),
                tool_events: Vec::new(),
                tool_event: None,
                agent_statuses: Vec::new(),
                pending_approval: None,
            },
        }
    }

    struct StreamEventBuilder {
        event: ApiStreamEvent,
    }

    impl StreamEventBuilder {
        fn with_chunk(mut self, chunk: &str) -> Self {
            self.event.chunk = chunk.to_string();
            self
        }

        fn with_message(mut self, message: &str) -> Self {
            self.event.message = message.to_string();
            self
        }

        fn with_error(mut self, error: &str) -> Self {
            self.event.error = error.to_string();
            self
        }

        fn with_sources(mut self, sources: Vec<Value>) -> Self {
            self.event.sources = sources;
            self
        }

        fn with_tool_events(mut self, tool_events: Vec<Value>) -> Self {
            self.event.tool_events = tool_events;
            self
        }

        fn with_tool_event(mut self, tool_event: Value) -> Self {
            self.event.tool_event = Some(tool_event);
            self
        }

        fn with_agent_statuses(mut self, agent_statuses: Vec<Value>) -> Self {
            self.event.agent_statuses = agent_statuses;
            self
        }

        fn with_pending_approval(mut self, pending_approval: Value) -> Self {
            self.event.pending_approval = Some(pending_approval);
            self
        }

        fn build(self) -> ApiStreamEvent {
            self.event
        }
    }
}
