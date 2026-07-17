use super::*;
use crate::runtime::{AppRuntime, RuntimeConfig};

fn run(status: RunStatus) -> RunRecord {
    RunRecord {
        id: "run-1".to_string(),
        prompt: "exercise projections".to_string(),
        model_id: None,
        project_id: None,
        status,
        output: Some("working".to_string()),
        error: None,
        created_at: 10,
        updated_at: 20,
        tool_events: vec![json!({"tool": "search"})],
        sources: vec![json!({"url": "https://example.com"})],
        agent_statuses: vec![json!({
            "agent": "researcher",
            "result": "Researching"
        })],
        pending_approval: Some(json!({"id": "approval-1"})),
    }
}

fn thread() -> ThreadRecord {
    ThreadRecord {
        id: "thread-1".to_string(),
        title: "Projection".to_string(),
        objective: "Cover projections".to_string(),
        state: ThreadState::Active,
        archived: false,
        source: "test".to_string(),
        task_mode: TaskMode::Work,
        parent_thread_id: None,
        turns: vec![TurnRecord {
            id: "turn-1".to_string(),
            thread_id: "thread-1".to_string(),
            run_id: "run-1".to_string(),
            status: TurnStatus::Queued,
            items: Vec::new(),
            created_at: 10,
            updated_at: 10,
        }],
        created_at: 10,
        updated_at: 10,
    }
}

#[test]
fn run_projection_emits_item_lifecycle_and_terminal_turn_events() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .save_thread_records(&[thread()])
        .expect("save fixture thread");

    let processing = run(RunStatus::Processing);
    let events = runtime
        .update_thread_for_run(&processing)
        .expect("project processing run");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, AppServerEvent::ItemStarted { .. }))
            .count(),
        5
    );

    let mut changed = processing.clone();
    changed.output = Some("still working".to_string());
    changed.updated_at = 21;
    let events = runtime
        .update_thread_for_run(&changed)
        .expect("project changed run");
    assert!(events
        .iter()
        .any(|event| matches!(event, AppServerEvent::ItemUpdated { .. })));

    let mut completed = changed;
    completed.status = RunStatus::Completed;
    completed.output = Some("done".to_string());
    completed.updated_at = 22;
    let events = runtime
        .update_thread_for_run(&completed)
        .expect("project completed run");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, AppServerEvent::ItemCompleted { .. }))
            .count(),
        5
    );
    assert!(events
        .iter()
        .any(|event| matches!(event, AppServerEvent::TurnCompleted { .. })));

    runtime
        .save_thread_records(&[thread()])
        .expect("reset fixture thread");
    let events = runtime
        .update_thread_for_run(&completed)
        .expect("project directly completed run");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event, AppServerEvent::ItemCompleted { .. }))
            .count(),
        5
    );

    let missing = RunRecord {
        id: "missing".to_string(),
        ..completed
    };
    assert!(runtime
        .update_thread_for_run(&missing)
        .expect("missing run is ignored")
        .is_empty());
}

#[test]
fn projection_maps_terminal_states_errors_and_replaces_existing_items() {
    let mut turn = thread().turns.remove(0);
    for (status, expected) in [
        (RunStatus::Queued, TurnStatus::Queued),
        (RunStatus::Failed, TurnStatus::Failed),
        (RunStatus::Canceled, TurnStatus::Interrupted),
    ] {
        let failed = status == RunStatus::Failed;
        let mut record = run(status);
        record.error = failed.then(|| "boom".to_string());
        project_run_to_turn(&mut turn, &record);
        assert_eq!(turn.status, expected);
    }
    assert_eq!(turn.items.len(), 5);
    assert_eq!(
        turn.items.last().map(|item| item.item_type),
        Some(ThreadItemType::AgentMessage)
    );

    let mut failed = run(RunStatus::Failed);
    failed.error = Some("boom".to_string());
    project_run_to_turn(&mut turn, &failed);
    assert_eq!(turn.items.len(), 6);
    assert_eq!(
        turn.items.last().map(|item| item.item_type),
        Some(ThreadItemType::Error)
    );
    assert_eq!(
        turn.items.last().map(|item| item.status),
        Some(ThreadItemStatus::Failed)
    );
}

#[test]
fn progress_projection_interleaves_assistant_updates_and_tools_in_realtime() {
    let mut turn = thread().turns.remove(0);
    let mut record = run(RunStatus::Processing);
    record.output = Some("I will inspect.".to_string());
    record.tool_events.clear();
    record.sources.clear();
    record.pending_approval = None;
    record.agent_statuses.clear();

    project_run_to_turn(&mut turn, &record);
    assert_eq!(turn.items.len(), 1);
    assert_eq!(turn.items[0].item_type, ThreadItemType::AgentMessage);
    assert_eq!(turn.items[0].content["text"], "I will inspect.");

    record.output = Some("I will inspect more.".to_string());
    record.updated_at += 1;
    project_run_to_turn(&mut turn, &record);
    assert_eq!(turn.items.len(), 1);
    assert_eq!(turn.items[0].content["text"], "I will inspect more.");

    record.tool_events = vec![json!({
        "toolName": "shell_command",
        "status": "running",
        "command": "rg TODO"
    })];
    record.updated_at += 1;
    project_run_to_turn(&mut turn, &record);
    assert_eq!(
        turn.items
            .iter()
            .map(|item| item.item_type)
            .collect::<Vec<_>>(),
        vec![
            ThreadItemType::AgentMessage,
            ThreadItemType::CommandExecution
        ]
    );
    assert_eq!(turn.items[1].status, ThreadItemStatus::InProgress);

    record.output = Some("I will inspect more.\nI found the relevant path.".to_string());
    record.updated_at += 1;
    project_run_to_turn(&mut turn, &record);
    assert_eq!(
        turn.items
            .iter()
            .map(|item| item.item_type)
            .collect::<Vec<_>>(),
        vec![
            ThreadItemType::AgentMessage,
            ThreadItemType::CommandExecution,
            ThreadItemType::AgentMessage,
        ]
    );
    assert_eq!(turn.items[2].content["text"], "I found the relevant path.");

    record.status = RunStatus::Completed;
    record.output = Some("I will inspect more.\nI found the relevant path.".to_string());
    record.tool_events[0]["status"] = json!("completed");
    record.tool_events[0]["success"] = json!(true);
    record.updated_at += 1;
    project_run_to_turn(&mut turn, &record);

    assert_eq!(turn.items.len(), 3, "final output should not be duplicated");
    assert!(turn
        .items
        .iter()
        .all(|item| item.status == ThreadItemStatus::Completed));
}

#[test]
fn progress_segments_keep_each_agents_cumulative_text_independent() {
    let mut turn = thread().turns.remove(0);
    let mut record = run(RunStatus::Processing);
    record.output = None;
    record.tool_events.clear();
    record.sources.clear();
    record.pending_approval = None;
    record.agent_statuses = vec![
        json!({"agentId": "one", "result": "Alpha"}),
        json!({"agentId": "two", "result": "Beta"}),
    ];

    project_run_to_turn(&mut turn, &record);
    record.tool_events = vec![json!({"toolName": "search", "status": "running"})];
    record.agent_statuses[0]["result"] = json!("Alpha\nAlpha follow-up");
    record.agent_statuses[1]["result"] = json!("Beta\nBeta follow-up");
    project_run_to_turn(&mut turn, &record);

    let updates = turn
        .items
        .iter()
        .filter(|item| item.item_type == ThreadItemType::AgentStatus)
        .map(|item| item.content["text"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(
        updates,
        vec!["Alpha", "Beta", "Alpha follow-up", "Beta follow-up"]
    );
}

#[test]
fn typed_projection_classifies_tools_plans_and_incremental_deltas() {
    assert_eq!(
        projected_tool_item_type(&json!({"toolName": "shell_command"})),
        ThreadItemType::CommandExecution
    );
    assert_eq!(
        projected_tool_item_type(&json!({"toolName": "write_file"})),
        ThreadItemType::FileChange
    );
    assert_eq!(
        projected_tool_item_type(&json!({"toolName": "search_web"})),
        ThreadItemType::ToolCall
    );
    assert_eq!(
        projected_plan(&[json!({"todos": [{"text": "verify"}]})]),
        Some(json!({"plan": [{"text": "verify"}]}))
    );

    let previous = ThreadItemRecord {
        id: "agent".to_string(),
        turn_id: "turn".to_string(),
        item_type: ThreadItemType::AgentMessage,
        status: ThreadItemStatus::InProgress,
        content: json!({"text": "hello"}),
        created_at: 1,
        updated_at: 1,
    };
    let current = ThreadItemRecord {
        content: json!({"text": "hello world"}),
        updated_at: 2,
        ..previous.clone()
    };
    assert!(matches!(
        item_delta_event("thread", "turn", &previous, &current),
        Some(AppServerEvent::ItemDelta { delta, .. }) if delta == " world"
    ));
}

#[test]
fn agent_session_fallback_and_metadata_updates_cover_state_variants() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let sessions = [
        ("paused", "paused"),
        ("cancelled", "cancelled"),
        ("canceled", "canceled"),
        ("active", "running"),
    ]
    .into_iter()
    .map(|(id, state)| AgentSessionRecord {
        session_id: id.to_string(),
        title: id.to_string(),
        objective: "objective".to_string(),
        state: state.to_string(),
        source: "test".to_string(),
        task_mode: TaskMode::Chat,
        parent_session_id: None,
        last_message: None,
        run_ids: Vec::new(),
        active_run_id: None,
        last_error: None,
        created_at: 1,
        updated_at: 1,
    })
    .collect::<Vec<_>>();
    runtime
        .save_agent_sessions(&sessions)
        .expect("save sessions");

    let threads = runtime.thread_records().expect("fallback threads");
    assert_eq!(threads[0].state, ThreadState::Paused);
    assert_eq!(threads[1].state, ThreadState::Canceled);
    assert_eq!(threads[2].state, ThreadState::Canceled);
    assert_eq!(threads[3].state, ThreadState::Active);

    runtime
        .save_thread_records(&[thread()])
        .expect("save native thread metadata");
    let merged_threads = runtime.thread_records().expect("merged thread records");
    assert_eq!(merged_threads.len(), 5);
    assert!(merged_threads.iter().any(|thread| thread.id == "thread-1"));
    assert!(merged_threads.iter().any(|thread| thread.id == "active"));

    runtime
        .update_agent_session_title("active", "Renamed")
        .expect("update title");
    runtime
        .update_agent_session_metadata("active", None, Some("New objective"))
        .expect("update objective");
    runtime
        .update_agent_session_state("active", "paused")
        .expect("update state");
    let updated = runtime
        .find_agent_session("active")
        .expect("updated session");
    assert_eq!(updated.title, "Renamed");
    assert_eq!(updated.objective, "New objective");
    assert_eq!(updated.state, "paused");
    assert!(runtime.find_agent_session("missing").is_err());
    assert!(runtime
        .update_agent_session_metadata("missing", Some("x"), None)
        .is_err());
}
