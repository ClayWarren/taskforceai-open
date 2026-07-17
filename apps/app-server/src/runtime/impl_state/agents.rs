use crate::protocol::*;
use serde_json::json;

use crate::runtime::error::RuntimeError;
use crate::runtime::util::*;
use crate::runtime::{AGENT_SESSIONS_METADATA_KEY, THREADS_METADATA_KEY};

impl crate::runtime::AppRuntime {
    pub(crate) fn thread_records(&self) -> Result<Vec<ThreadRecord>, RuntimeError> {
        let sessions = self.agent_sessions()?;
        if let Some(store) = &self.run_store {
            if store.has_threads()? {
                return store.load_all_threads().map_err(Into::into);
            }
        }
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
            if let Some(store) = &self.run_store {
                store.replace_threads(&threads)?;
            }
            return Ok(threads);
        }
        let threads = sessions
            .into_iter()
            .map(thread_from_agent_session)
            .collect::<Vec<_>>();
        if let Some(store) = &self.run_store {
            store.replace_threads(&threads)?;
        }
        Ok(threads)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn save_thread_records(
        &mut self,
        threads: &[ThreadRecord],
    ) -> Result<(), RuntimeError> {
        if let Some(store) = &self.run_store {
            store.replace_threads(threads)?;
            self.set_metadata_json(THREADS_METADATA_KEY, &Vec::<ThreadRecord>::new())?;
            Ok(())
        } else {
            self.set_metadata_json(THREADS_METADATA_KEY, threads)
        }
    }

    pub(crate) fn save_thread_record(&mut self, thread: &ThreadRecord) -> Result<(), RuntimeError> {
        if let Some(store) = &self.run_store {
            store.upsert_thread(thread)?;
            Ok(())
        } else {
            let mut threads = self.thread_records()?;
            match threads
                .iter()
                .position(|candidate| candidate.id == thread.id)
            {
                Some(index) => threads[index] = thread.clone(),
                None => threads.push(thread.clone()),
            }
            self.set_metadata_json(THREADS_METADATA_KEY, &threads)
        }
    }

    pub(crate) fn delete_thread_record(&mut self, thread_id: &str) -> Result<bool, RuntimeError> {
        if let Some(store) = &self.run_store {
            store.delete_thread(thread_id).map_err(Into::into)
        } else {
            let mut threads = self.thread_records()?;
            let before = threads.len();
            threads.retain(|thread| thread.id != thread_id);
            self.set_metadata_json(THREADS_METADATA_KEY, &threads)?;
            Ok(before != threads.len())
        }
    }

    pub(crate) fn find_thread_record(&self, thread_id: &str) -> Result<ThreadRecord, RuntimeError> {
        if let Some(store) = &self.run_store {
            return store
                .get_thread(thread_id)?
                .ok_or_else(|| RuntimeError::not_found("thread not found"));
        }
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
        self.save_thread_record(&updated_thread)?;

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
                Some(previous) if previous.content != item.content => {
                    if let Some(delta) =
                        item_delta_event(&thread_id, &updated_turn.id, previous, item)
                    {
                        events.push(delta);
                    }
                    if item.item_type == ThreadItemType::Plan {
                        events.push(AppServerEvent::PlanUpdated {
                            thread_id: thread_id.clone(),
                            turn_id: updated_turn.id.clone(),
                            item_id: item.id.clone(),
                            plan: item.content.clone(),
                        });
                    }
                    AppServerEvent::ItemUpdated {
                        thread_id: thread_id.clone(),
                        turn_id: updated_turn.id.clone(),
                        item: Box::new(item.clone()),
                    }
                }
                Some(_) => continue,
            };
            events.push(event);
            if previous.is_none() && item.item_type == ThreadItemType::Plan {
                events.push(AppServerEvent::PlanUpdated {
                    thread_id: thread_id.clone(),
                    turn_id: updated_turn.id.clone(),
                    item_id: item.id.clone(),
                    plan: item.content.clone(),
                });
            }
        }
        if matches!(
            updated_turn.status,
            TurnStatus::Completed | TurnStatus::Failed | TurnStatus::Interrupted
        ) {
            events.push(AppServerEvent::TurnCompleted {
                thread_id: thread_id.clone(),
                turn: Box::new(updated_turn.clone()),
            });
        }
        events.push(AppServerEvent::TurnDiffUpdated {
            thread_id: thread_id.clone(),
            turn_id: updated_turn.id.clone(),
            diff: Self::diff_for_turn(&updated_turn),
        });
        events.push(AppServerEvent::ThreadTokenUsageUpdated {
            thread_id,
            usage: self.usage_for_thread(&updated_thread),
        });
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
    let turn_id = turn.id.clone();
    let turn_created_at = turn.created_at;
    let legacy_message_id = format!("{turn_id}:agent-message");
    let error_id = format!("{turn_id}:error");
    turn.items
        .retain(|item| item.id != legacy_message_id && item.id != error_id);
    for (index, tool) in run.tool_events.iter().enumerate() {
        let item_type = projected_tool_item_type(tool);
        let mut item = projected_item(
            &turn_id,
            turn_created_at,
            run,
            "tool",
            index,
            item_type,
            tool.clone(),
        );
        item.status = projected_activity_status(tool, run);
        upsert_thread_item(&mut turn.items, item);
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
        project_agent_progress_segment(
            turn,
            run,
            index,
            status,
            "result",
            ThreadItemType::AgentStatus,
        );
        project_agent_progress_segment(
            turn,
            run,
            index,
            status,
            "reasoning",
            ThreadItemType::Reasoning,
        );
    }
    if matches!(
        run.status,
        RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
    ) {
        let terminal_status = if run.status == RunStatus::Completed {
            ThreadItemStatus::Completed
        } else {
            ThreadItemStatus::Failed
        };
        for item in &mut turn.items {
            match item.item_type {
                ThreadItemType::AgentMessage => {
                    item.status = ThreadItemStatus::Completed;
                    item.updated_at = run.updated_at;
                }
                ThreadItemType::AgentStatus | ThreadItemType::Reasoning => {
                    item.status = terminal_status;
                    item.updated_at = run.updated_at;
                }
                _ => {}
            }
        }
    }
    if let Some(plan) = projected_plan(&run.agent_statuses) {
        upsert_thread_item(
            &mut turn.items,
            projected_item(
                &turn_id,
                turn_created_at,
                run,
                "plan",
                0,
                ThreadItemType::Plan,
                plan,
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

    let output = run.output.as_deref().map(str::trim).unwrap_or_default();
    let final_error = run.error.as_deref().map(str::trim).unwrap_or_default();
    let duplicates_agent_progress = !output.is_empty()
        && turn.items.iter().any(|item| {
            item.id.contains(":agent-status:")
                && item
                    .content
                    .get("fullResult")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|text| text.trim() == output)
        });
    if !output.is_empty() && !duplicates_agent_progress {
        let status = if matches!(run.status, RunStatus::Queued | RunStatus::Processing) {
            ThreadItemStatus::InProgress
        } else {
            ThreadItemStatus::Completed
        };
        project_text_segment(
            turn,
            run,
            "agent-message",
            output,
            ThreadItemType::AgentMessage,
            status,
            json!({}),
        );
    }
    if !final_error.is_empty() {
        turn.items.push(ThreadItemRecord {
            id: error_id,
            turn_id,
            item_type: ThreadItemType::Error,
            status: ThreadItemStatus::Failed,
            content: json!({"error": final_error}),
            created_at: turn_created_at,
            updated_at: run.updated_at,
        });
    }
}

fn project_agent_progress_segment(
    turn: &mut TurnRecord,
    run: &RunRecord,
    agent_index: usize,
    status: &serde_json::Value,
    field: &str,
    item_type: ThreadItemType,
) {
    let Some(full) = status
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
    else {
        return;
    };
    let family = if field == "reasoning" {
        format!("agent-reasoning:{agent_index}")
    } else {
        format!("agent-status:{agent_index}")
    };
    let status_value = projected_activity_status(status, run);
    project_text_segment(
        turn,
        run,
        &family,
        full,
        item_type,
        status_value,
        json!({
            "agentId": status.get("agent_id").or_else(|| status.get("agentId")),
            "model": status.get("model"),
        }),
    );
}

fn project_text_segment(
    turn: &mut TurnRecord,
    run: &RunRecord,
    family: &str,
    full: &str,
    item_type: ThreadItemType,
    status: ThreadItemStatus,
    mut metadata: serde_json::Value,
) {
    let generation = run.tool_events.len();
    let id = format!("{}:{family}:segment:{generation}", turn.id);
    let existing_base = turn
        .items
        .iter()
        .find(|item| item.id == id)
        .and_then(|item| item.content.get("baseResult"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned);
    let previous_full = latest_progress_full(&turn.items, family).unwrap_or_default();
    let base = existing_base.as_deref().unwrap_or(previous_full);
    let visible = full.strip_prefix(base).unwrap_or(full).trim_start();
    if visible.is_empty() {
        return;
    }
    let content = metadata
        .as_object_mut()
        .expect("projection metadata is an object");
    content.insert("text".to_string(), json!(visible));
    content.insert("fullResult".to_string(), json!(full));
    content.insert("baseResult".to_string(), json!(base));
    let item = ThreadItemRecord {
        id,
        turn_id: turn.id.clone(),
        item_type,
        status,
        content: metadata,
        created_at: turn.created_at,
        updated_at: run.updated_at,
    };
    upsert_thread_item(&mut turn.items, item);
}

fn latest_progress_full<'a>(items: &'a [ThreadItemRecord], family: &str) -> Option<&'a str> {
    let family = format!(":{family}:segment:");
    items.iter().rev().find_map(|item| {
        (item.id.contains(&family))
            .then(|| {
                item.content
                    .get("fullResult")
                    .and_then(serde_json::Value::as_str)
            })
            .flatten()
    })
}

fn projected_activity_status(content: &serde_json::Value, run: &RunRecord) -> ThreadItemStatus {
    let status = content
        .get("status")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if content.get("success").and_then(serde_json::Value::as_bool) == Some(false)
        || status.contains("fail")
        || status.contains("error")
    {
        ThreadItemStatus::Failed
    } else if content.get("success").and_then(serde_json::Value::as_bool) == Some(true)
        || status.contains("complete")
        || status.contains("success")
        || matches!(run.status, RunStatus::Completed)
    {
        ThreadItemStatus::Completed
    } else {
        ThreadItemStatus::InProgress
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

fn projected_tool_item_type(tool: &serde_json::Value) -> ThreadItemType {
    let name = tool
        .get("toolName")
        .or_else(|| tool.get("name"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ["shell", "bash", "command", "exec", "process", "terminal"]
        .iter()
        .any(|candidate| name.contains(candidate))
    {
        ThreadItemType::CommandExecution
    } else if [
        "write_file",
        "edit_file",
        "move_file",
        "patch",
        "create_directory",
    ]
    .iter()
    .any(|candidate| name.contains(candidate))
    {
        ThreadItemType::FileChange
    } else {
        ThreadItemType::ToolCall
    }
}

fn projected_plan(statuses: &[serde_json::Value]) -> Option<serde_json::Value> {
    statuses.iter().rev().find_map(|status| {
        status
            .get("plan")
            .or_else(|| status.get("todos"))
            .cloned()
            .map(|plan| json!({"plan": plan}))
    })
}

fn item_delta_event(
    thread_id: &str,
    turn_id: &str,
    previous: &ThreadItemRecord,
    current: &ThreadItemRecord,
) -> Option<AppServerEvent> {
    for field in delta_fields(current.item_type) {
        let before = previous
            .content
            .get(field)
            .and_then(serde_json::Value::as_str);
        let after = current
            .content
            .get(field)
            .and_then(serde_json::Value::as_str);
        let (Some(before), Some(after)) = (before, after) else {
            continue;
        };
        if let Some(delta) = after.strip_prefix(before).filter(|delta| !delta.is_empty()) {
            return Some(AppServerEvent::ItemDelta {
                thread_id: thread_id.to_string(),
                turn_id: turn_id.to_string(),
                item_id: current.id.clone(),
                item_type: current.item_type,
                field: (*field).to_string(),
                delta: delta.to_string(),
            });
        }
    }
    None
}

fn delta_fields(item_type: ThreadItemType) -> &'static [&'static str] {
    match item_type {
        ThreadItemType::AgentMessage | ThreadItemType::AgentStatus | ThreadItemType::Reasoning => {
            &["text"]
        }
        ThreadItemType::CommandExecution => &["output", "text"],
        ThreadItemType::FileChange => &["diff", "patch", "text"],
        _ => &[],
    }
}

#[cfg(test)]
#[path = "agents/tests.rs"]
mod tests;
