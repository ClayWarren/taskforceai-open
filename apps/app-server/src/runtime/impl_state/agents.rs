use crate::protocol::*;
use serde_json::json;

use crate::runtime::error::RuntimeError;
use crate::runtime::util::*;
use crate::runtime::{AGENT_SESSIONS_METADATA_KEY, THREADS_METADATA_KEY};

impl crate::runtime::AppRuntime {
    pub(crate) fn thread_records(&self) -> Result<Vec<ThreadRecord>, RuntimeError> {
        let sessions = self.agent_sessions()?;
        if let Some(mut threads) = self.metadata_json::<Vec<ThreadRecord>>(THREADS_METADATA_KEY)? {
            let existing_ids = threads
                .iter()
                .map(|thread| thread.id.clone())
                .collect::<std::collections::HashSet<_>>();
            let legacy_threads = sessions
                .iter()
                .filter(|session| !existing_ids.contains(&session.session_id))
                .cloned()
                .map(thread_from_agent_session)
                .collect::<Vec<_>>();
            threads.extend(legacy_threads);
            return Ok(threads);
        }
        Ok(sessions
            .into_iter()
            .map(thread_from_agent_session)
            .collect())
    }

    pub(crate) fn save_thread_records(
        &mut self,
        threads: &[ThreadRecord],
    ) -> Result<(), RuntimeError> {
        self.set_metadata_json(THREADS_METADATA_KEY, threads)
    }

    pub(crate) fn find_thread_record(&self, thread_id: &str) -> Result<ThreadRecord, RuntimeError> {
        self.thread_records()?
            .into_iter()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| RuntimeError::not_found("thread not found"))
    }

    pub(crate) fn update_thread_for_run(
        &mut self,
        run: &RunRecord,
    ) -> Result<Vec<AppServerEvent>, RuntimeError> {
        let mut threads = self.thread_records()?;
        let Some((thread_index, turn_index)) =
            threads
                .iter()
                .enumerate()
                .find_map(|(thread_index, thread)| {
                    thread
                        .turns
                        .iter()
                        .position(|turn| turn.run_id == run.id)
                        .map(|turn_index| (thread_index, turn_index))
                })
        else {
            return Ok(Vec::new());
        };
        let thread_id = threads[thread_index].id.clone();
        let (previous_items, updated_turn) = {
            let turn = &mut threads[thread_index].turns[turn_index];
            let previous_items = turn.items.clone();
            project_run_to_turn(turn, run);
            (previous_items, turn.clone())
        };
        threads[thread_index].updated_at = run.updated_at;
        let updated_thread = threads[thread_index].clone();
        self.save_thread_records(&threads)?;

        let mut events = vec![AppServerEvent::TurnUpdated {
            thread_id: thread_id.clone(),
            turn: Box::new(updated_turn.clone()),
        }];
        for item in &updated_turn.items {
            let previous = previous_items
                .iter()
                .find(|candidate| candidate.id == item.id);
            let event = match previous {
                None if item.status == ThreadItemStatus::InProgress => {
                    AppServerEvent::ItemStarted {
                        thread_id: thread_id.clone(),
                        turn_id: updated_turn.id.clone(),
                        item: Box::new(item.clone()),
                    }
                }
                None => AppServerEvent::ItemCompleted {
                    thread_id: thread_id.clone(),
                    turn_id: updated_turn.id.clone(),
                    item: Box::new(item.clone()),
                },
                Some(previous)
                    if previous.status != item.status
                        && item.status != ThreadItemStatus::InProgress =>
                {
                    AppServerEvent::ItemCompleted {
                        thread_id: thread_id.clone(),
                        turn_id: updated_turn.id.clone(),
                        item: Box::new(item.clone()),
                    }
                }
                Some(previous) if previous.content != item.content => AppServerEvent::ItemUpdated {
                    thread_id: thread_id.clone(),
                    turn_id: updated_turn.id.clone(),
                    item: Box::new(item.clone()),
                },
                Some(_) => continue,
            };
            events.push(event);
        }
        if matches!(
            updated_turn.status,
            TurnStatus::Completed | TurnStatus::Failed | TurnStatus::Interrupted
        ) {
            events.push(AppServerEvent::TurnCompleted {
                thread_id,
                turn: Box::new(updated_turn),
            });
        }
        events.push(AppServerEvent::ThreadUpdated {
            thread: Box::new(updated_thread),
        });
        Ok(events)
    }

    pub(crate) fn agent_sessions(&self) -> Result<Vec<AgentSessionRecord>, RuntimeError> {
        Ok(self
            .metadata_json(AGENT_SESSIONS_METADATA_KEY)?
            .unwrap_or_default())
    }

    pub(crate) fn save_agent_sessions(
        &mut self,
        sessions: &[AgentSessionRecord],
    ) -> Result<(), RuntimeError> {
        self.set_metadata_json(AGENT_SESSIONS_METADATA_KEY, sessions)
    }

    pub(crate) fn find_agent_session(
        &self,
        session_id: &str,
    ) -> Result<AgentSessionRecord, RuntimeError> {
        self.agent_sessions()?
            .into_iter()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))
    }

    pub(crate) fn update_agent_session_state(
        &mut self,
        session_id: &str,
        state: &str,
    ) -> Result<AppResponse, RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        session.state = state.to_string();
        session.updated_at = unix_millis();
        let saved = session.clone();
        self.save_agent_sessions(&sessions)?;
        Ok(value(AgentSessionResult { session: saved }))
    }

    pub(crate) fn update_agent_session_title(
        &mut self,
        session_id: &str,
        title: &str,
    ) -> Result<(), RuntimeError> {
        self.update_agent_session_metadata(session_id, Some(title), None)
    }

    pub(crate) fn update_agent_session_metadata(
        &mut self,
        session_id: &str,
        title: Option<&str>,
        objective: Option<&str>,
    ) -> Result<(), RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        if let Some(title) = title {
            session.title = title.to_string();
        }
        if let Some(objective) = objective {
            session.objective = objective.to_string();
        }
        session.updated_at = unix_millis();
        self.save_agent_sessions(&sessions)
    }

    pub(crate) fn track_agent_session_run(
        &mut self,
        session_id: &str,
        run: &RunRecord,
    ) -> Result<AgentSessionRecord, RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        if !session.run_ids.iter().any(|run_id| run_id == &run.id) {
            session.run_ids.push(run.id.clone());
        }
        session.active_run_id = Some(run.id.clone());
        session.state = agent_session_state_for_run_status(&run.status).to_string();
        session.last_error = run.error.clone();
        session.updated_at = run.updated_at;
        let saved = session.clone();
        self.save_agent_sessions(&sessions)?;
        Ok(saved)
    }

    pub(crate) fn update_agent_session_for_run(
        &mut self,
        run: &RunRecord,
    ) -> Result<(), RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let mut changed = false;
        for session in &mut sessions {
            let owns_run = session.active_run_id.as_deref() == Some(run.id.as_str())
                || session.run_ids.iter().any(|run_id| run_id == &run.id);
            if !owns_run {
                continue;
            }
            session.state = agent_session_state_for_run_status(&run.status).to_string();
            if run.status != RunStatus::Queued && run.status != RunStatus::Processing {
                session.active_run_id = None;
            } else {
                session.active_run_id = Some(run.id.clone());
            }
            session.last_error = run.error.clone();
            session.updated_at = run.updated_at;
            changed = true;
        }
        if changed {
            self.save_agent_sessions(&sessions)?;
        }
        Ok(())
    }
}

fn thread_from_agent_session(session: AgentSessionRecord) -> ThreadRecord {
    let state = match session.state.as_str() {
        "paused" => ThreadState::Paused,
        "cancelled" | "canceled" => ThreadState::Canceled,
        _ => ThreadState::Active,
    };
    ThreadRecord {
        id: session.session_id,
        title: session.title,
        objective: session.objective,
        state,
        archived: false,
        source: session.source,
        task_mode: session.task_mode,
        parent_thread_id: session.parent_session_id,
        turns: Vec::new(),
        created_at: session.created_at,
        updated_at: session.updated_at,
    }
}

fn project_run_to_turn(turn: &mut TurnRecord, run: &RunRecord) {
    turn.status = match run.status {
        RunStatus::Queued => TurnStatus::Queued,
        RunStatus::Processing => TurnStatus::InProgress,
        RunStatus::Completed => TurnStatus::Completed,
        RunStatus::Failed => TurnStatus::Failed,
        RunStatus::Canceled => TurnStatus::Interrupted,
    };
    turn.updated_at = run.updated_at;
    upsert_thread_item(
        &mut turn.items,
        ThreadItemRecord {
            id: format!("{}:agent-message", turn.id),
            turn_id: turn.id.clone(),
            item_type: if run.error.is_some() {
                ThreadItemType::Error
            } else {
                ThreadItemType::AgentMessage
            },
            status: match run.status {
                RunStatus::Queued | RunStatus::Processing => ThreadItemStatus::InProgress,
                RunStatus::Completed => ThreadItemStatus::Completed,
                RunStatus::Failed | RunStatus::Canceled => ThreadItemStatus::Failed,
            },
            content: json!({
                "text": run.output,
                "error": run.error,
            }),
            created_at: turn.created_at,
            updated_at: run.updated_at,
        },
    );
    let turn_id = turn.id.clone();
    let turn_created_at = turn.created_at;
    for (index, tool) in run.tool_events.iter().enumerate() {
        upsert_thread_item(
            &mut turn.items,
            projected_item(
                &turn_id,
                turn_created_at,
                run,
                "tool",
                index,
                ThreadItemType::ToolCall,
                tool.clone(),
            ),
        );
    }
    for (index, source) in run.sources.iter().enumerate() {
        upsert_thread_item(
            &mut turn.items,
            projected_item(
                &turn_id,
                turn_created_at,
                run,
                "source",
                index,
                ThreadItemType::Source,
                source.clone(),
            ),
        );
    }
    for (index, status) in run.agent_statuses.iter().enumerate() {
        upsert_thread_item(
            &mut turn.items,
            projected_item(
                &turn_id,
                turn_created_at,
                run,
                "agent-status",
                index,
                ThreadItemType::AgentStatus,
                status.clone(),
            ),
        );
    }
    if let Some(approval) = &run.pending_approval {
        upsert_thread_item(
            &mut turn.items,
            projected_item(
                &turn_id,
                turn_created_at,
                run,
                "approval",
                0,
                ThreadItemType::Approval,
                approval.clone(),
            ),
        );
    }
}

fn projected_item(
    turn_id: &str,
    turn_created_at: u64,
    run: &RunRecord,
    family: &str,
    index: usize,
    item_type: ThreadItemType,
    content: serde_json::Value,
) -> ThreadItemRecord {
    ThreadItemRecord {
        id: format!("{turn_id}:{family}:{index}"),
        turn_id: turn_id.to_string(),
        item_type,
        status: if matches!(run.status, RunStatus::Queued | RunStatus::Processing) {
            ThreadItemStatus::InProgress
        } else {
            ThreadItemStatus::Completed
        },
        content,
        created_at: turn_created_at,
        updated_at: run.updated_at,
    }
}

fn upsert_thread_item(items: &mut Vec<ThreadItemRecord>, item: ThreadItemRecord) {
    if let Some(existing) = items.iter_mut().find(|existing| existing.id == item.id) {
        *existing = item;
    } else {
        items.push(item);
    }
}

#[cfg(test)]
mod tests {
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
            agent_statuses: vec![json!({"agent": "researcher"})],
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
        assert_eq!(turn.items[0].item_type, ThreadItemType::AgentMessage);

        let mut failed = run(RunStatus::Failed);
        failed.error = Some("boom".to_string());
        project_run_to_turn(&mut turn, &failed);
        assert_eq!(turn.items.len(), 5);
        assert_eq!(turn.items[0].item_type, ThreadItemType::Error);
        assert_eq!(turn.items[0].status, ThreadItemStatus::Failed);
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
}
