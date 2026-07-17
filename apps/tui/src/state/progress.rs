use std::time::{Duration, Instant};

use serde_json::Value;
use taskforceai_app_protocol::{ContextSummaryResult, RunRecord, ThreadItemType, ThreadRecord};

use super::{AppState, TaskMode, TodoItem};

const CONTEXT_REFRESH_INTERVAL: Duration = Duration::from_secs(15);

impl AppState {
    pub fn context_refresh_due(&self, now: Instant) -> bool {
        self.initialized.capabilities.context && now >= self.next_context_refresh_at
    }

    pub fn apply_context_summary(&mut self, summary: ContextSummaryResult) {
        self.context_summary = Some(summary);
        self.next_context_refresh_at = Instant::now() + CONTEXT_REFRESH_INTERVAL;
    }

    pub fn mark_context_refresh_failed(&mut self) {
        self.next_context_refresh_at = Instant::now() + CONTEXT_REFRESH_INTERVAL;
    }

    pub fn context_usage_percent(&self) -> Option<usize> {
        let summary = self.context_summary.as_ref()?;
        if summary.max_tokens == 0 {
            return None;
        }
        Some(
            summary
                .estimated_tokens
                .saturating_mul(100)
                .div_ceil(summary.max_tokens)
                .min(100),
        )
    }

    pub fn visible_todos(&self) -> &[TodoItem] {
        if self.task_mode.shows_task_progress() {
            &self.todos
        } else {
            &[]
        }
    }

    pub(crate) fn refresh_progress_from_current_surface(&mut self) {
        self.todos = if let Some(thread) = self.active_thread() {
            todos_from_thread(thread)
        } else if let Some(run) = self.selected_run() {
            todos_from_run(run)
        } else {
            Vec::new()
        };
        if self.task_mode == TaskMode::Chat {
            self.todos.clear();
        }
    }

    pub(crate) fn apply_plan_value(&mut self, plan: &Value) {
        self.todos = todos_from_value(plan).unwrap_or_default();
        if self.task_mode == TaskMode::Chat {
            self.todos.clear();
        }
    }
}

fn todos_from_thread(thread: &ThreadRecord) -> Vec<TodoItem> {
    thread
        .turns
        .iter()
        .rev()
        .flat_map(|turn| turn.items.iter().rev())
        .filter(|item| {
            matches!(
                item.item_type,
                ThreadItemType::Plan | ThreadItemType::ToolCall
            )
        })
        .find_map(|item| todos_from_value(&item.content))
        .unwrap_or_default()
}

fn todos_from_run(run: &RunRecord) -> Vec<TodoItem> {
    run.tool_events
        .iter()
        .rev()
        .find_map(todos_from_value)
        .unwrap_or_default()
}

fn todos_from_value(value: &Value) -> Option<Vec<TodoItem>> {
    let values = find_todo_array(value)?;
    let todos = values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| todo_from_value(value, index))
        .collect::<Vec<_>>();
    (!todos.is_empty()).then_some(todos)
}

fn find_todo_array(value: &Value) -> Option<&Vec<Value>> {
    if let Some(values) = value.as_array() {
        return Some(values);
    }
    let object = value.as_object()?;
    for key in ["todos", "plan"] {
        if let Some(values) = object.get(key).and_then(Value::as_array) {
            return Some(values);
        }
    }
    for key in [
        "metadata",
        "result",
        "output",
        "arguments",
        "args",
        "input",
        "content",
    ] {
        if let Some(nested) = object.get(key) {
            if let Some(values) = find_todo_array(nested) {
                return Some(values);
            }
        }
    }
    None
}

fn todo_from_value(value: &Value, index: usize) -> Option<TodoItem> {
    let object = value.as_object()?;
    let content = ["content", "step", "title", "text"]
        .into_iter()
        .find_map(|key| object.get(key).and_then(Value::as_str))?
        .trim();
    if content.is_empty() {
        return None;
    }
    let status = object
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending");
    let status = match status.to_ascii_lowercase().as_str() {
        "todo" | "queued" | "not_started" => "pending",
        "inprogress" | "in-progress" | "running" => "in_progress",
        "done" | "complete" => "completed",
        "canceled" => "cancelled",
        other => other,
    }
    .to_string();
    Some(TodoItem {
        id: object
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("todo-{index}")),
        content: content.to_string(),
        status,
        priority: object
            .get("priority")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::ContextSummaryResult;

    use crate::test_support::{initialized, initialized_default_capabilities};

    use super::*;

    #[test]
    fn extracts_todo_and_update_plan_shapes() {
        let tool = json!({
            "toolName": "todowrite",
            "result": {"metadata": {"todos": [
                {"id":"one","content":"Inspect","status":"in_progress","priority":"high"},
                {"id":"two","content":"Verify","status":"todo","priority":"medium"}
            ]}}
        });
        let todos = todos_from_value(&tool).expect("todos");
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[1].status, "pending");

        let plan = json!({"plan":[{"step":"Ship","status":"completed"}]});
        assert_eq!(todos_from_value(&plan).expect("plan")[0].content, "Ship");

        let direct = json!([
            {"title":"Queue","status":"queued"},
            {"text":"Run","status":"running"},
            {"content":"Cancel","status":"canceled"},
            {"content":"Complete","status":"complete"},
            {"content":"Custom","status":"blocked"},
            {"content":"  ","status":"done"},
            "invalid"
        ]);
        let todos = todos_from_value(&direct).expect("direct todos");
        assert_eq!(todos.len(), 5);
        assert_eq!(todos[0].id, "todo-0");
        assert_eq!(todos[1].status, "in_progress");
        assert_eq!(todos[2].status, "cancelled");
        assert_eq!(todos[3].status, "completed");
        assert_eq!(todos[4].status, "blocked");
        assert!(todos_from_value(&json!({"content": []})).is_none());

        let now = Instant::now();
        let mut state = AppState::new(initialized(), Vec::new());
        state.next_context_refresh_at = now;
        assert!(state.context_refresh_due(now));
        state.apply_context_summary(ContextSummaryResult {
            max_tokens: 100,
            estimated_tokens: 51,
            items: Vec::new(),
            suggestions: Vec::new(),
        });
        assert_eq!(state.context_usage_percent(), Some(51));
        state.context_summary.as_mut().unwrap().estimated_tokens = 101;
        assert_eq!(state.context_usage_percent(), Some(100));
        state.context_summary.as_mut().unwrap().max_tokens = 0;
        assert_eq!(state.context_usage_percent(), None);
        state.mark_context_refresh_failed();

        let mut no_context = AppState::new(initialized_default_capabilities(), Vec::new());
        no_context.next_context_refresh_at = now;
        assert!(!no_context.context_refresh_due(now));
        assert_eq!(no_context.context_usage_percent(), None);
        no_context.task_mode = TaskMode::Chat;
        no_context.apply_plan_value(&plan);
        assert!(no_context.visible_todos().is_empty());
    }
}
