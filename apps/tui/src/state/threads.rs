use taskforceai_app_protocol::{
    ThreadItemRecord, ThreadItemType, ThreadRecord, ThreadState, TurnRecord, TurnStatus,
};

use super::AppState;

impl AppState {
    pub fn active_thread(&self) -> Option<&ThreadRecord> {
        let id = self.active_thread_id.as_deref()?;
        self.threads.iter().find(|thread| thread.id == id)
    }

    pub fn active_turn(&self) -> Option<&TurnRecord> {
        self.active_thread()?
            .turns
            .iter()
            .rev()
            .find(|turn| matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress))
    }

    pub fn copyable_text(&self) -> String {
        if let Some(output) = &self.command_output {
            return output.clone();
        }
        if let Some(thread) = self.active_thread() {
            return thread
                .turns
                .iter()
                .flat_map(|turn| &turn.items)
                .filter_map(|item| {
                    let label = match item.item_type {
                        ThreadItemType::UserMessage => "You",
                        ThreadItemType::AgentMessage => "TaskForceAI",
                        ThreadItemType::Reasoning => "Reasoning",
                        ThreadItemType::ToolCall => "Tool",
                        ThreadItemType::Approval => "Approval",
                        ThreadItemType::Source => "Source",
                        ThreadItemType::AgentStatus => "Agent",
                        ThreadItemType::Error => "Error",
                        ThreadItemType::SteeringMessage => "Steer",
                    };
                    let content = item
                        .content
                        .as_str()
                        .map(ToOwned::to_owned)
                        .or_else(|| {
                            ["text", "message", "output", "command", "url"]
                                .iter()
                                .find_map(|key| {
                                    item.content.get(key).and_then(|value| value.as_str())
                                })
                                .map(ToOwned::to_owned)
                        })
                        .unwrap_or_else(|| item.content.to_string());
                    (!content.trim().is_empty()).then(|| format!("{label}: {content}"))
                })
                .collect::<Vec<_>>()
                .join("\n\n");
        }
        self.selected_run()
            .and_then(|run| run.output.as_ref().or(run.error.as_ref()))
            .cloned()
            .unwrap_or_default()
    }

    pub fn active_background_tools(&self) -> Vec<String> {
        self.active_thread()
            .into_iter()
            .flat_map(|thread| &thread.turns)
            .flat_map(|turn| &turn.items)
            .filter(|item| {
                item.item_type == ThreadItemType::ToolCall
                    && matches!(
                        item.status,
                        taskforceai_app_protocol::ThreadItemStatus::InProgress
                    )
            })
            .map(|item| {
                item.content
                    .get("command")
                    .or_else(|| item.content.get("name"))
                    .or_else(|| item.content.get("tool"))
                    .and_then(|value| value.as_str())
                    .unwrap_or(&item.id)
                    .to_string()
            })
            .collect()
    }

    pub fn set_threads(&mut self, threads: Vec<ThreadRecord>) {
        self.threads = threads;
        if self
            .active_thread_id
            .as_ref()
            .is_some_and(|id| !self.threads.iter().any(|thread| &thread.id == id))
        {
            self.active_thread_id = None;
        }
    }

    pub fn set_active_thread(&mut self, thread: ThreadRecord) {
        let id = thread.id.clone();
        self.task_mode = match thread.task_mode {
            taskforceai_app_protocol::TaskMode::Chat => super::TaskMode::Chat,
            taskforceai_app_protocol::TaskMode::Work => super::TaskMode::Work,
            taskforceai_app_protocol::TaskMode::Code => super::TaskMode::Code,
        };
        self.upsert_thread(thread);
        self.active_thread_id = Some(id);
        self.command_output = None;
        self.detail_scroll_offset = 0;
    }

    pub fn upsert_thread(&mut self, thread: ThreadRecord) {
        let id = thread.id.clone();
        if let Some(existing) = self.threads.iter_mut().find(|item| item.id == id) {
            *existing = thread;
        } else {
            self.threads.insert(0, thread);
        }
        self.active_thread_id.get_or_insert(id);
        self.status_line = "Thread updated".to_string();
    }

    pub(super) fn upsert_turn(&mut self, thread_id: String, turn: TurnRecord) {
        let thread = self.ensure_thread(&thread_id);
        if let Some(existing) = thread.turns.iter_mut().find(|item| item.id == turn.id) {
            *existing = turn;
        } else {
            thread.turns.push(turn);
        }
        thread.updated_at = thread
            .turns
            .iter()
            .map(|item| item.updated_at)
            .max()
            .unwrap_or(thread.updated_at);
        self.active_thread_id = Some(thread_id);
        self.status_line = "Turn updated".to_string();
    }

    pub(super) fn upsert_thread_item(
        &mut self,
        thread_id: String,
        turn_id: String,
        item: ThreadItemRecord,
    ) {
        let now = item.updated_at;
        let thread = self.ensure_thread(&thread_id);
        let turn = if let Some(index) = thread.turns.iter().position(|turn| turn.id == turn_id) {
            &mut thread.turns[index]
        } else {
            thread.turns.push(TurnRecord {
                id: turn_id.clone(),
                thread_id: thread_id.clone(),
                run_id: String::new(),
                status: TurnStatus::InProgress,
                items: Vec::new(),
                created_at: now,
                updated_at: now,
            });
            thread.turns.last_mut().expect("turn was just inserted")
        };
        if let Some(existing) = turn
            .items
            .iter_mut()
            .find(|existing| existing.id == item.id)
        {
            *existing = item;
        } else {
            turn.items.push(item);
        }
        turn.updated_at = now;
        thread.updated_at = now;
        self.active_thread_id = Some(thread_id);
        self.status_line = "Agent activity updated".to_string();
    }

    fn ensure_thread(&mut self, thread_id: &str) -> &mut ThreadRecord {
        if let Some(index) = self
            .threads
            .iter()
            .position(|thread| thread.id == thread_id)
        {
            return &mut self.threads[index];
        }
        let task_mode = match self.task_mode {
            super::TaskMode::Chat => taskforceai_app_protocol::TaskMode::Chat,
            super::TaskMode::Work => taskforceai_app_protocol::TaskMode::Work,
            super::TaskMode::Code => taskforceai_app_protocol::TaskMode::Code,
        };
        self.threads.push(ThreadRecord {
            id: thread_id.to_string(),
            title: "Active task".to_string(),
            objective: String::new(),
            state: ThreadState::Active,
            archived: false,
            source: "app-server".to_string(),
            task_mode,
            parent_thread_id: None,
            turns: Vec::new(),
            created_at: 0,
            updated_at: 0,
        });
        self.threads.last_mut().expect("thread was just inserted")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::{ThreadItemStatus, ThreadItemType};

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn streamed_items_build_copyable_transcript_and_process_list() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.task_mode = crate::state::TaskMode::Code;
        state.upsert_thread_item(
            "thread".to_string(),
            "turn".to_string(),
            ThreadItemRecord {
                id: "user".to_string(),
                turn_id: "turn".to_string(),
                item_type: ThreadItemType::UserMessage,
                status: ThreadItemStatus::Completed,
                content: json!({"text": "Run tests"}),
                created_at: 1,
                updated_at: 1,
            },
        );
        state.upsert_thread_item(
            "thread".to_string(),
            "turn".to_string(),
            ThreadItemRecord {
                id: "tool".to_string(),
                turn_id: "turn".to_string(),
                item_type: ThreadItemType::ToolCall,
                status: ThreadItemStatus::InProgress,
                content: json!({"command": "cargo test"}),
                created_at: 2,
                updated_at: 2,
            },
        );
        assert!(state.copyable_text().contains("You: Run tests"));
        assert_eq!(state.active_background_tools(), vec!["cargo test"]);
        assert_eq!(
            state.active_thread().expect("thread").task_mode,
            taskforceai_app_protocol::TaskMode::Code
        );
    }

    #[test]
    fn thread_state_edges_cover_updates_transcripts_and_fallbacks() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        assert!(state.active_thread().is_none());
        assert!(state.active_turn().is_none());
        assert_eq!(state.copyable_text(), "");
        assert!(state.active_background_tools().is_empty());
        state.command_output = Some("command output".into());
        assert_eq!(state.copyable_text(), "command output");
        state.command_output = None;

        let thread = |id: &str, mode: &str| -> ThreadRecord {
            serde_json::from_value(json!({
                "id":id, "title":"Task", "objective":"Objective", "state":"active",
                "archived":false, "source":"test", "taskMode":mode, "parentThreadId":null,
                "turns":[], "createdAt":1, "updatedAt":1
            }))
            .expect("thread")
        };
        state.active_thread_id = Some("missing".into());
        state.set_threads(vec![thread("chat", "chat")]);
        assert!(state.active_thread_id.is_none());
        for (id, mode) in [("chat", "chat"), ("work", "work"), ("code", "code")] {
            state.set_active_thread(thread(id, mode));
            assert_eq!(state.active_thread_id.as_deref(), Some(id));
        }

        let mut replacement = thread("code", "code");
        replacement.title = "Updated".into();
        state.upsert_thread(replacement);
        assert_eq!(state.active_thread().expect("active").title, "Updated");

        let turn = |status: &str| -> TurnRecord {
            serde_json::from_value(json!({
                "id":"turn", "threadId":"new-thread", "runId":"run", "status":status,
                "items":[], "createdAt":2, "updatedAt":3
            }))
            .expect("turn")
        };
        state.upsert_turn("new-thread".into(), turn("queued"));
        assert!(state.active_turn().is_some());
        state.upsert_turn("new-thread".into(), turn("completed"));
        assert!(state.active_turn().is_none());

        let item_types = [
            ThreadItemType::UserMessage,
            ThreadItemType::AgentMessage,
            ThreadItemType::Reasoning,
            ThreadItemType::ToolCall,
            ThreadItemType::Approval,
            ThreadItemType::Source,
            ThreadItemType::AgentStatus,
            ThreadItemType::Error,
            ThreadItemType::SteeringMessage,
        ];
        for (index, item_type) in item_types.into_iter().enumerate() {
            state.upsert_thread_item(
                "new-thread".into(),
                "stream".into(),
                ThreadItemRecord {
                    id: format!("item-{index}"),
                    turn_id: "stream".into(),
                    item_type,
                    status: if index == 3 {
                        ThreadItemStatus::InProgress
                    } else {
                        ThreadItemStatus::Completed
                    },
                    content: match index % 4 {
                        0 => json!("plain"),
                        1 => json!({"message":"message"}),
                        2 => json!({"other":index}),
                        _ => json!({"name":"tool-name"}),
                    },
                    created_at: index as u64,
                    updated_at: index as u64,
                },
            );
        }
        state.upsert_thread_item(
            "new-thread".into(),
            "stream".into(),
            ThreadItemRecord {
                id: "item-0".into(),
                turn_id: "stream".into(),
                item_type: ThreadItemType::UserMessage,
                status: ThreadItemStatus::Completed,
                content: json!({"text":"replacement"}),
                created_at: 9,
                updated_at: 10,
            },
        );
        state.upsert_thread_item(
            "new-thread".into(),
            "stream".into(),
            ThreadItemRecord {
                id: "completed-tool".into(),
                turn_id: "stream".into(),
                item_type: ThreadItemType::ToolCall,
                status: ThreadItemStatus::Completed,
                content: json!({"tool":"finished-tool"}),
                created_at: 10,
                updated_at: 10,
            },
        );
        let transcript = state.copyable_text();
        assert!(transcript.contains("You: replacement"));
        assert_eq!(state.active_background_tools(), vec!["tool-name"]);

        let mut work = AppState::new(initialized_default_capabilities(), Vec::new());
        work.task_mode = crate::state::TaskMode::Work;
        work.upsert_thread_item(
            "work-thread".into(),
            "turn".into(),
            ThreadItemRecord {
                id: "work-item".into(),
                turn_id: "turn".into(),
                item_type: ThreadItemType::AgentStatus,
                status: ThreadItemStatus::Completed,
                content: json!("done"),
                created_at: 1,
                updated_at: 1,
            },
        );
        assert_eq!(
            work.active_thread().expect("work thread").task_mode,
            taskforceai_app_protocol::TaskMode::Work
        );
    }
}
