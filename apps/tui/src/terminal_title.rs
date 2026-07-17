use taskforceai_app_protocol::RunStatus;

use crate::state::AppState;

pub(crate) fn title(state: &AppState) -> String {
    let mode = match state.task_mode {
        crate::state::TaskMode::Chat => "Chat",
        crate::state::TaskMode::Work => "Work",
        crate::state::TaskMode::Code => "Code",
    };
    let activity = if state.pending_interaction.is_some() {
        "action required"
    } else if state
        .runs
        .iter()
        .any(|run| matches!(run.status, RunStatus::Queued | RunStatus::Processing))
        || state.active_turn().is_some()
    {
        "running"
    } else {
        "ready"
    };
    let task = state
        .active_thread()
        .map(|thread| thread.title.as_str())
        .or_else(|| state.selected_run().map(|run| run.prompt.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate(value, 48));
    sanitize(&match task {
        Some(task) => format!("TaskForceAI {mode} · {activity} · {task}"),
        None => format!("TaskForceAI {mode} · {activity}"),
    })
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(96)
        .collect()
}

fn truncate(value: &str, max: usize) -> String {
    let mut characters = value.chars();
    let mut output = characters.by_ref().take(max).collect::<String>();
    if characters.next().is_some() {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::{JsonRpcServerRequest, RunRecord, RunStatus};

    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn title_tracks_mode_activity_and_sanitizes_task_text() {
        let mut state = AppState::new(
            initialized_default_capabilities(),
            vec![RunRecord {
                id: "run".into(),
                prompt: "Ship\u{1b} the TUI".into(),
                model_id: None,
                project_id: None,
                status: RunStatus::Processing,
                output: None,
                error: None,
                created_at: 0,
                updated_at: 0,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            }],
        );
        state.task_mode = crate::state::TaskMode::Code;
        let rendered_title = title(&state);
        assert!(rendered_title.contains("Code · running"));
        assert!(!rendered_title.contains('\u{1b}'));

        state.task_mode = crate::state::TaskMode::Work;
        state.runs.clear();
        state.selected_run_id = None;
        state.selected_run_index = None;
        assert_eq!(title(&state), "TaskForceAI Work · ready");

        state.pending_interaction = Some(
            crate::state::PendingInteraction::from_request(JsonRpcServerRequest {
                jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
                id: json!(1),
                method: "item/commandExecution/requestApproval".to_string(),
                params: json!({
                    "threadId":"thread", "turnId":"turn", "itemId":"item",
                    "command":["echo", "ok"], "reason":"approve"
                }),
            })
            .expect("approval"),
        );
        state.task_mode = crate::state::TaskMode::Chat;
        assert_eq!(title(&state), "TaskForceAI Chat · action required");

        state.pending_interaction = None;
        state.runs = vec![RunRecord {
            id: "long".into(),
            prompt: "x".repeat(60),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: None,
            error: None,
            created_at: 0,
            updated_at: 0,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }];
        state.selected_run_id = Some("long".into());
        state.selected_run_index = Some(0);
        assert!(title(&state).ends_with('…'));
    }
}
