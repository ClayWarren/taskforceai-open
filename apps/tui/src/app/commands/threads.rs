use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{ThreadIDParams, ThreadNameSetParams, ThreadRollbackParams};

use crate::state::AppState;

use super::show_command;

pub(super) async fn handle_resume(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let listed = client.thread_list().await?;
    state.set_threads(listed.threads);
    let requested = args.join(" ");
    let thread_id = if requested.trim().is_empty() || requested == "last" {
        state
            .threads
            .iter()
            .find(|thread| !thread.archived)
            .map(|thread| thread.id.clone())
    } else {
        Some(requested.trim().to_string())
    };
    let Some(thread_id) = thread_id else {
        show_command(state, "Resume", "No saved threads are available.");
        return Ok(true);
    };
    let resumed = client.thread_resume(ThreadIDParams { thread_id }).await?;
    let title = resumed.thread.title.clone();
    state.set_active_thread(resumed.thread);
    show_command(state, "Resume", format!("Resumed {title}."));
    state.command_output = None;
    Ok(true)
}

pub(super) async fn handle_fork(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let Some(thread_id) = target_thread_id(state, &args) else {
        show_command(
            state,
            "Fork",
            "Resume a thread first or use /fork <thread-id>.",
        );
        return Ok(true);
    };
    let forked = client.thread_fork(ThreadIDParams { thread_id }).await?;
    let title = forked.thread.title.clone();
    state.set_active_thread(forked.thread);
    show_command(state, "Fork", format!("Created {title}."));
    state.command_output = None;
    Ok(true)
}

pub(super) async fn handle_rename(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let title = args.join(" ").trim().to_string();
    if title.is_empty() {
        show_command(state, "Rename", "Usage: /rename <new title>");
        return Ok(true);
    }
    let Some(thread_id) = state.active_thread_id.clone() else {
        show_command(state, "Rename", "Resume a thread before renaming it.");
        return Ok(true);
    };
    let renamed = client
        .thread_name_set(ThreadNameSetParams { thread_id, title })
        .await?;
    let title = renamed.thread.title.clone();
    state.set_active_thread(renamed.thread);
    show_command(state, "Rename", format!("Renamed thread to {title}."));
    Ok(true)
}

pub(super) async fn handle_archive(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let Some(thread_id) = target_thread_id(state, &args) else {
        show_command(
            state,
            "Archive",
            "Resume a thread first or use /archive <thread-id>.",
        );
        return Ok(true);
    };
    let archived = client.thread_archive(ThreadIDParams { thread_id }).await?;
    let title = archived.thread.title.clone();
    state.upsert_thread(archived.thread);
    state.active_thread_id = None;
    show_command(state, "Archive", format!("Archived {title}."));
    Ok(true)
}

pub(super) async fn handle_rollback(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let Some(thread_id) = state.active_thread_id.clone() else {
        show_command(state, "Rollback", "Resume a thread before rolling it back.");
        return Ok(true);
    };
    let requested = args.join(" ");
    let turn_id = if requested.trim().is_empty() {
        state
            .active_thread()
            .and_then(|thread| thread.turns.last())
            .map(|turn| turn.id.clone())
    } else {
        Some(requested.trim().to_string())
    };
    let Some(turn_id) = turn_id else {
        show_command(
            state,
            "Rollback",
            "The active thread has no turns to roll back.",
        );
        return Ok(true);
    };
    let rolled_back = client
        .thread_rollback(ThreadRollbackParams { thread_id, turn_id })
        .await?;
    state.set_active_thread(rolled_back.thread);
    show_command(state, "Rollback", "Rolled back the selected turn.");
    state.command_output = None;
    Ok(true)
}

fn target_thread_id(state: &AppState, args: &[&str]) -> Option<String> {
    let requested = args.join(" ");
    if requested.trim().is_empty() {
        state.active_thread_id.clone()
    } else {
        Some(requested.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::initialized_default_capabilities;

    #[test]
    fn target_thread_prefers_explicit_trimmed_argument() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.active_thread_id = Some("active".into());
        assert_eq!(target_thread_id(&state, &[]), Some("active".into()));
        assert_eq!(
            target_thread_id(&state, &[" explicit "]),
            Some("explicit".into())
        );
    }
}
