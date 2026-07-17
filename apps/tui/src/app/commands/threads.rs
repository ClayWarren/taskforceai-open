use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{
    ThreadIDParams, ThreadItemType, ThreadListParams, ThreadNameSetParams, ThreadRollbackParams,
    TurnRecord,
};

use crate::state::{AppState, PickerKind, PickerOption};

use super::show_command;

// coverage:ignore-start -- command adapter performs thread-list/get/import RPC.
pub(super) async fn handle_resume(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let mut listed = client
        .thread_list_filtered(ThreadListParams {
            limit: Some(200),
            include_turns: Some(false),
            ..ThreadListParams::default()
        })
        .await?;
    while listed.threads.len() < 5_000 {
        let Some(cursor) = listed.next_cursor.take() else {
            break;
        };
        let next = client
            .thread_list_filtered(ThreadListParams {
                cursor: Some(cursor),
                limit: Some(200),
                include_turns: Some(false),
                ..ThreadListParams::default()
            })
            .await?;
        listed.threads.extend(next.threads);
        listed.next_cursor = next.next_cursor;
    }
    state.set_threads(listed.threads);
    let requested = args.join(" ");
    if requested.trim().is_empty() {
        let options = state
            .threads
            .iter()
            .map(|thread| {
                let archive = if thread.archived { "archived · " } else { "" };
                PickerOption::new(
                    thread.id.clone(),
                    thread.title.clone(),
                    format!(
                        "{archive}{} · {} · updated {}",
                        format!("{:?}", thread.task_mode).to_ascii_lowercase(),
                        thread.source,
                        thread.updated_at
                    ),
                    format!(
                        "{} {} {} {}",
                        thread.id, thread.title, thread.objective, thread.source
                    ),
                )
            })
            .collect::<Vec<_>>();
        if options.is_empty() {
            show_command(state, "Resume", "No saved threads are available.");
        } else {
            state.open_picker(PickerKind::Resume, "Resume a conversation", options, None);
        }
        return Ok(true);
    }
    let thread_id = if requested == "last" {
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
// coverage:ignore-end

// coverage:ignore-start -- command adapter performs live thread fork RPC.
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
// coverage:ignore-end

// coverage:ignore-start -- command adapter performs live thread rename RPC.
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
// coverage:ignore-end

// coverage:ignore-start -- command adapter performs live thread archive RPC.
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
    let was_active = state.active_thread_id.as_deref() == Some(thread_id.as_str());
    let archived = client.thread_archive(ThreadIDParams { thread_id }).await?;
    let title = archived.thread.title.clone();
    state.upsert_thread(archived.thread);
    if was_active {
        state.active_thread_id = None;
    }
    show_command(state, "Archive", format!("Archived {title}."));
    Ok(true)
}
// coverage:ignore-end

// coverage:ignore-start -- command adapter performs live thread rollback RPC.
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
        let options = state
            .active_thread()
            .into_iter()
            .flat_map(|thread| thread.turns.iter())
            .rev()
            .map(rollback_option)
            .collect::<Vec<_>>();
        if options.is_empty() {
            show_command(
                state,
                "Rollback",
                "The active thread has no turns to roll back.",
            );
        } else {
            state.open_picker(
                PickerKind::Rollback,
                "Roll back to an earlier turn",
                options,
                None,
            );
        }
        return Ok(true);
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
// coverage:ignore-end

fn rollback_option(turn: &TurnRecord) -> PickerOption {
    let prompt = turn
        .items
        .iter()
        .find(|item| {
            matches!(
                item.item_type,
                ThreadItemType::UserMessage | ThreadItemType::SteeringMessage
            )
        })
        .and_then(|item| {
            item.content
                .as_str()
                .or_else(|| item.content.get("text").and_then(serde_json::Value::as_str))
                .or_else(|| {
                    item.content
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                })
        })
        .unwrap_or("Turn without a saved prompt")
        .replace('\n', " ");
    let preview = prompt.chars().take(100).collect::<String>();
    PickerOption::new(
        turn.id.clone(),
        preview.clone(),
        format!(
            "{:?} · created {} · keeps this turn and removes newer turns",
            turn.status, turn.created_at
        )
        .to_ascii_lowercase(),
        format!("{} {prompt}", turn.id),
    )
}

// coverage:ignore-start -- agent navigation opens and refreshes threads through app-server RPC.
pub(super) async fn handle_agent_navigation(
    client: &mut AppServerClient,
    state: &mut AppState,
    args: Vec<&str>,
) -> Result<bool, AppClientError> {
    let listed = client.thread_list().await?;
    state.set_threads(listed.threads);
    match args.first().copied().unwrap_or("list") {
        "list" | "status" => {
            let related = related_thread_ids(state);
            if related.is_empty() {
                show_command(
                    state,
                    "Agents",
                    "No parent or child agent threads are available.",
                );
            } else {
                let active = state.active_thread_id.as_deref();
                let lines = related
                    .iter()
                    .filter_map(|id| state.threads.iter().find(|thread| &thread.id == id))
                    .map(|thread| {
                        format!(
                            "{} {} · {} · {}",
                            if active == Some(thread.id.as_str()) {
                                ">"
                            } else {
                                " "
                            },
                            thread.title,
                            thread.id,
                            format!("{:?}", thread.state).to_ascii_lowercase()
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                show_command(
                    state,
                    "Agents",
                    format!("{lines}\n\nUse /agent next, /agent parent, or /agent <thread-id>. Ctrl-G cycles related agents."),
                );
            }
        }
        "next" => navigate_related_thread(client, state, 1).await?,
        "previous" | "prev" => navigate_related_thread(client, state, -1).await?,
        "parent" => {
            let Some(parent) = state
                .active_thread()
                .and_then(|thread| thread.parent_thread_id.clone())
            else {
                show_command(state, "Agents", "The active thread has no parent agent.");
                return Ok(true);
            };
            open_thread(client, state, parent).await?;
        }
        thread_id => open_thread(client, state, thread_id.to_string()).await?,
    }
    Ok(true)
}

pub(crate) async fn navigate_related_thread(
    client: &mut AppServerClient,
    state: &mut AppState,
    delta: isize,
) -> Result<(), AppClientError> {
    let listed = client.thread_list().await?;
    state.set_threads(listed.threads);
    let related = related_thread_ids(state);
    if related.len() < 2 {
        state.status_line = "No related agent thread to navigate".to_string();
        return Ok(());
    }
    let current = state
        .active_thread_id
        .as_ref()
        .and_then(|id| related.iter().position(|candidate| candidate == id))
        .unwrap_or(0);
    let len = related.len() as isize;
    let next = (current as isize + delta).rem_euclid(len) as usize;
    open_thread(client, state, related[next].clone()).await
}
// coverage:ignore-end

fn related_thread_ids(state: &AppState) -> Vec<String> {
    let Some(active) = state.active_thread() else {
        return Vec::new();
    };
    let family_parent = active.parent_thread_id.as_deref().unwrap_or(&active.id);
    let mut ids = Vec::new();
    if state
        .threads
        .iter()
        .any(|thread| thread.id == family_parent)
    {
        ids.push(family_parent.to_string());
    }
    ids.extend(
        state
            .threads
            .iter()
            .filter(|thread| thread.parent_thread_id.as_deref() == Some(family_parent))
            .map(|thread| thread.id.clone()),
    );
    ids.sort_by_key(|id| {
        state
            .threads
            .iter()
            .find(|thread| &thread.id == id)
            .map_or(0, |thread| thread.created_at)
    });
    ids.dedup();
    ids
}

// coverage:ignore-start -- loads a selected thread through live app-server RPC.
async fn open_thread(
    client: &AppServerClient,
    state: &mut AppState,
    thread_id: String,
) -> Result<(), AppClientError> {
    let result = client.thread_read(ThreadIDParams { thread_id }).await?;
    let title = result.thread.title.clone();
    state.set_active_thread(result.thread);
    state.command_output = None;
    state.focus = crate::state::FocusArea::Runs;
    state.status_line = format!("Viewing agent thread: {title}");
    Ok(())
}
// coverage:ignore-end

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
    use crate::test_support::{initialized_default_capabilities, start_rpc_sequence_server};
    use serde_json::json;

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

    #[test]
    fn related_threads_include_parent_and_siblings() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        assert!(related_thread_ids(&state).is_empty());
        let thread = |id: &str, parent: Option<&str>, created_at: u64| {
            serde_json::from_value(serde_json::json!({
                "id":id, "title":id, "objective":"", "state":"active", "archived":false,
                "source":"test", "taskMode":"work", "parentThreadId":parent, "turns":[],
                "createdAt":created_at, "updatedAt":created_at
            }))
            .expect("thread")
        };
        state.set_threads(vec![
            thread("parent", None, 1),
            thread("child-a", Some("parent"), 2),
            thread("child-b", Some("parent"), 3),
        ]);
        state.active_thread_id = Some("child-a".to_string());
        assert_eq!(related_thread_ids(&state), ["parent", "child-a", "child-b"]);
    }

    #[test]
    fn rollback_preview_reads_legacy_message_and_fallback_content() {
        let turn: TurnRecord = serde_json::from_value(json!({
            "id":"turn", "threadId":"thread", "runId":"run", "status":"completed",
            "items":[{
                "id":"prompt", "turnId":"turn", "type":"steeringMessage", "status":"completed",
                "content":{"message":"Legacy steering prompt"}, "createdAt":1, "updatedAt":1
            }], "createdAt":1, "updatedAt":2
        }))
        .expect("turn");
        assert_eq!(rollback_option(&turn).title, "Legacy steering prompt");

        let empty: TurnRecord = serde_json::from_value(json!({
            "id":"empty", "threadId":"thread", "runId":"run", "status":"completed",
            "items":[{
                "id":"agent", "turnId":"empty", "type":"agentMessage", "status":"completed",
                "content":{"text":"not a prompt"}, "createdAt":1, "updatedAt":1
            }], "createdAt":1, "updatedAt":2
        }))
        .expect("turn");
        assert_eq!(rollback_option(&empty).title, "Turn without a saved prompt");
    }

    #[tokio::test]
    async fn archiving_an_explicit_background_thread_preserves_the_active_thread() {
        let (base_url, server) = start_rpc_sequence_server(vec![(
            "thread/archive",
            json!({
                "thread": {
                    "id":"background", "title":"Background", "objective":"", "state":"canceled",
                    "archived":true, "source":"test", "taskMode":"work", "parentThreadId":null,
                    "turns":[], "createdAt":1, "updatedAt":2
                }
            }),
        )]);
        let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.active_thread_id = Some("foreground".into());

        handle_archive(&mut client, &mut state, vec!["background"])
            .await
            .expect("archive");

        assert_eq!(state.active_thread_id.as_deref(), Some("foreground"));
        server.join().expect("archive rpc");
    }

    #[tokio::test]
    async fn resume_without_an_id_opens_searchable_picker() {
        let (base_url, server) = start_rpc_sequence_server(vec![(
            "thread/list",
            json!({
                "threads": [{
                    "id":"saved", "title":"Saved chat", "objective":"Compare TUIs",
                    "state":"active", "archived":false, "source":"tui", "taskMode":"chat",
                    "parentThreadId":null, "turns":[], "createdAt":1, "updatedAt":2
                }]
            }),
        )]);
        let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());

        handle_resume(&mut client, &mut state, Vec::new())
            .await
            .expect("resume picker");

        assert_eq!(state.picker_kind(), Some(PickerKind::Resume));
        assert_eq!(
            state
                .selected_picker_option()
                .map(|option| option.value.as_str()),
            Some("saved")
        );
        server.join().expect("thread list rpc");
    }

    #[tokio::test]
    async fn rollback_without_an_id_opens_turn_timeline() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.set_active_thread(
            serde_json::from_value(json!({
                "id":"thread", "title":"Work", "objective":"", "state":"active",
                "archived":false, "source":"tui", "taskMode":"work", "parentThreadId":null,
                "turns":[{
                    "id":"turn-1", "threadId":"thread", "runId":"run-1", "status":"completed",
                    "items":[{
                        "id":"prompt", "turnId":"turn-1", "type":"userMessage",
                        "status":"completed", "content":{"text":"First prompt"},
                        "createdAt":1, "updatedAt":1
                    }], "createdAt":1, "updatedAt":2
                }], "createdAt":1, "updatedAt":2
            }))
            .expect("thread"),
        );
        let (base_url, server) = start_rpc_sequence_server(Vec::new());
        let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");

        handle_rollback(&mut client, &mut state, Vec::new())
            .await
            .expect("rollback timeline");

        assert_eq!(state.picker_kind(), Some(PickerKind::Rollback));
        assert_eq!(
            state
                .selected_picker_option()
                .map(|option| option.title.as_str()),
            Some("First prompt")
        );
        server.join().expect("no rpc expected");
    }
}
