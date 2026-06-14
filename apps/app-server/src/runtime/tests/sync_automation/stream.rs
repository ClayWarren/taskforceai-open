use super::super::*;

#[test]
fn stream_events_merge_sources_tools_statuses_and_approvals() {
    let now = unix_millis();
    let run = RunRecord {
        id: "run-stream-meta".to_string(),
        prompt: "collect metadata".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Queued,
        output: None,
        error: None,
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "progress".to_string(),
            chunk: "chunk".to_string(),
            message: String::new(),
            error: String::new(),
            sources: vec![json!({"url":"https://example.com","title":"Example"})],
            tool_events: vec![json!({"toolName":"search","success":true})],
            tool_event: Some(json!({"toolName":"computer_use","status":"running"})),
            agent_statuses: vec![json!({"status":"running"})],
            pending_approval: Some(json!({"permission":"mcp","agentName":"Ops"})),
        },
    );
    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "complete".to_string(),
            chunk: String::new(),
            message: "done".to_string(),
            error: String::new(),
            sources: vec![
                json!({"url":"https://example.com","title":"Duplicate"}),
                json!({"url":"https://docs.example.com","title":"Docs"}),
            ],
            tool_events: vec![json!({"toolName":"browser","success":true})],
            tool_event: None,
            agent_statuses: vec![json!({"status":"completed"})],
            pending_approval: None,
        },
    );

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(run.sources.len(), 2);
    assert_eq!(run.tool_events.len(), 3);
    assert_eq!(run.tool_events[1]["toolName"], "computer_use");
    assert_eq!(run.agent_statuses[0]["status"], "completed");
    assert_eq!(
        run.pending_approval
            .as_ref()
            .expect("approval should persist")["permission"],
        "mcp"
    );
}

#[test]
fn stream_events_upsert_cumulative_tool_usage_histories() {
    let now = unix_millis();
    let run = RunRecord {
        id: "run-tool-history".to_string(),
        prompt: "collect metadata".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Queued,
        output: None,
        error: None,
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "progress".to_string(),
            chunk: String::new(),
            message: String::new(),
            error: String::new(),
            sources: Vec::new(),
            tool_events: vec![json!({
                "invocationId": "call-1",
                "toolName": "computer_use",
                "status": "running",
                "image_base64": "first"
            })],
            tool_event: None,
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );
    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "progress".to_string(),
            chunk: String::new(),
            message: String::new(),
            error: String::new(),
            sources: Vec::new(),
            tool_events: vec![
                json!({
                    "invocationId": "call-1",
                    "toolName": "computer_use",
                    "status": "completed",
                    "image_base64": "latest"
                }),
                json!({
                    "invocationId": "call-2",
                    "toolName": "search",
                    "status": "completed"
                }),
            ],
            tool_event: None,
            agent_statuses: Vec::new(),
            pending_approval: None,
        },
    );

    assert_eq!(run.tool_events.len(), 2);
    assert_eq!(run.tool_events[0]["status"], "completed");
    assert_eq!(run.tool_events[0]["image_base64"], "latest");
    assert_eq!(run.tool_events[1]["invocationId"], "call-2");
}

#[test]
fn stream_complete_uses_agent_result_when_message_is_generic_non_answer() {
    let now = unix_millis();
    let run = RunRecord {
        id: "run-generic-final".to_string(),
        prompt: "Biggest news in AI".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Processing,
        output: None,
        error: None,
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "complete".to_string(),
            chunk: String::new(),
            message: "Hello! I'm ready to help you. What can I do for you today?".to_string(),
            error: String::new(),
            sources: Vec::new(),
            tool_events: Vec::new(),
            tool_event: None,
            agent_statuses: vec![json!({
                "status": "COMPLETED",
                "result": "Here is the current AI news summary from the agent."
            })],
            pending_approval: None,
        },
    );

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(
        run.output.as_deref(),
        Some("Here is the current AI news summary from the agent.")
    );
}

#[test]
fn stream_complete_hides_internal_team_message_when_no_summary_exists() {
    let now = unix_millis();
    let run = RunRecord {
        id: "run-internal-final".to_string(),
        prompt: "Biggest current AI news".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Processing,
        output: None,
        error: None,
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "complete".to_string(),
            chunk: String::new(),
            message: "[Received message from Agent-1: Team - we've been tasked with researching current AI news. I've added 3 tasks to the board.]".to_string(),
            error: String::new(),
            sources: Vec::new(),
            tool_events: Vec::new(),
            tool_event: None,
            agent_statuses: vec![json!({
                "status": "COMPLETED",
                "result": "Agent completed task using tools: search_web. (No summary provided by model)"
            })],
            pending_approval: None,
        },
    );

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(
        run.output.as_deref(),
        Some("The agents completed their work, but no final summary was provided.")
    );
}

#[test]
fn stream_complete_uses_tool_evidence_when_agent_summary_is_missing() {
    let now = unix_millis();
    let run = RunRecord {
        id: "run-tool-evidence-final".to_string(),
        prompt: "Use computer_use to inspect the desktop".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Processing,
        output: None,
        error: None,
        created_at: now,
        updated_at: now,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    let run = apply_stream_event_to_run(
        run,
        ApiStreamEvent {
            event_type: "complete".to_string(),
            chunk: String::new(),
            message:
                "Agent completed task using tools: computer_use. (No summary provided by model)"
                    .to_string(),
            error: String::new(),
            sources: Vec::new(),
            tool_events: vec![json!({
                "toolName": "computer_use",
                "success": true,
                "arguments": {"action": "type", "text": "terminal"},
                "image_base64": "encoded-screen"
            })],
            tool_event: None,
            agent_statuses: vec![json!({
                "status": "COMPLETED",
                "result": "Agent completed task using tools: computer_use. (No summary provided by model)"
            })],
            pending_approval: None,
        },
    );

    assert_eq!(run.status, RunStatus::Completed);
    assert_eq!(
        run.output.as_deref(),
        Some(
            "Computer use completed 1 action and captured the desktop; latest action: type \"terminal\"."
        )
    );
}

#[test]
fn new_mcp_approval_matches_go_tui_metadata_shape() {
    let approval = json!({
        "permission": "mcp",
        "agentName": "Ops",
        "metadata": {
            "source": "mcp",
            "action": "tool_call",
            "serverName": "files",
            "toolName": "read",
            "arguments": {"path": "README.md"}
        }
    });
    assert!(new_mcp_approval(None, Some(&approval)).is_some());
    assert!(new_mcp_approval(Some(&approval), Some(&approval)).is_none());

    let changed = json!({
        "metadata": {
            "source": "mcp",
            "action": "tool_call",
            "serverName": "files",
            "toolName": "write"
        }
    });
    assert!(new_mcp_approval(Some(&approval), Some(&changed)).is_some());

    let non_mcp = json!({
        "metadata": {
            "source": "browser",
            "action": "tool_call",
            "serverName": "files",
            "toolName": "read"
        }
    });
    assert!(new_mcp_approval(None, Some(&non_mcp)).is_none());
}
