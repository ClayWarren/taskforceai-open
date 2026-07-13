#[cfg(not(test))]
use std::io::Write;
#[cfg(not(test))]
use std::process::{Command, Stdio};

use taskforceai_app_client::{AppClientError, AppServerClient};
use taskforceai_app_protocol::{RunIDParams, TurnInterruptParams};

use crate::state::AppState;

use super::show_command;

pub(super) fn handle_copy(state: &mut AppState) -> Result<bool, AppClientError> {
    let text = state.copyable_text();
    if text.trim().is_empty() {
        show_command(state, "Copy", "There is no response or transcript to copy.");
        return Ok(true);
    }
    match copy_to_clipboard(&text) {
        Ok(()) => show_command(state, "Copy", "Copied the visible response as plain text."),
        Err(err) => show_command(
            state,
            "Copy",
            format!("Clipboard unavailable: {err}\nUse /raw and terminal selection instead."),
        ),
    }
    Ok(true)
}

pub(super) fn handle_raw(state: &mut AppState, args: Vec<&str>) -> Result<bool, AppClientError> {
    state.raw_output_mode = match args.first().copied() {
        Some("on" | "true" | "1") => true,
        Some("off" | "false" | "0") => false,
        _ => !state.raw_output_mode,
    };
    state.prompt_input.clear();
    state.prompt_cursor = 0;
    state.command_output = None;
    state.status_line = if state.raw_output_mode {
        "Raw output mode enabled; use /raw off to restore the UI"
    } else {
        "Raw output mode disabled"
    }
    .to_string();
    Ok(true)
}

pub(super) fn handle_processes(state: &mut AppState) -> Result<bool, AppClientError> {
    let processes = state.active_background_tools();
    let message = if processes.is_empty() {
        "No background tool calls are active.".to_string()
    } else {
        processes
            .iter()
            .enumerate()
            .map(|(index, process)| format!("{}. {process}", index + 1))
            .collect::<Vec<_>>()
            .join("\n")
    };
    show_command(state, "Background processes", message);
    Ok(true)
}

pub(super) async fn handle_stop(
    client: &mut AppServerClient,
    state: &mut AppState,
) -> Result<bool, AppClientError> {
    if let Some(thread_id) = state.active_thread_id.clone() {
        let result = client
            .turn_interrupt(TurnInterruptParams { thread_id })
            .await?;
        state.set_active_thread(result.thread);
        show_command(
            state,
            "Stop",
            "Interrupted the active task and its background tools.",
        );
        state.command_output = None;
        return Ok(true);
    }
    if let Some(run_id) = state.selected_run_id().map(ToOwned::to_owned) {
        let result = client.run_cancel(RunIDParams { run_id }).await?;
        state.upsert_run(result.run);
        show_command(state, "Stop", "Canceled the selected conversation.");
        return Ok(true);
    }
    show_command(state, "Stop", "No active task or conversation to stop.");
    Ok(true)
}

fn copy_to_clipboard(text: &str) -> std::io::Result<()> {
    #[cfg(test)]
    {
        if text == "__clipboard_error__" {
            Err(std::io::Error::other("clipboard command failed"))
        } else {
            Ok(())
        }
    }
    #[cfg(not(test))]
    {
        #[cfg(target_os = "macos")]
        let mut child = Command::new("pbcopy").stdin(Stdio::piped()).spawn()?;
        #[cfg(target_os = "windows")]
        let mut child = Command::new("clip").stdin(Stdio::piped()).spawn()?;
        #[cfg(all(unix, not(target_os = "macos")))]
        let mut child = Command::new("sh")
            .args([
                "-c",
                "command -v wl-copy >/dev/null && exec wl-copy || exec xclip -selection clipboard",
            ])
            .stdin(Stdio::piped())
            .spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes())?;
        }
        let status = child.wait()?;
        if status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other("clipboard command failed"))
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_protocol::{
        ThreadItemRecord, ThreadItemStatus, ThreadItemType, TurnStatus,
    };

    use super::*;
    use crate::test_support::{initialized_default_capabilities, start_rpc_sequence_server};

    #[test]
    fn raw_and_process_commands_use_current_transcript_state() {
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.apply(crate::state::UiAction::ServerEvent(
            taskforceai_app_protocol::AppServerEvent::ItemStarted {
                thread_id: "thread".to_string(),
                turn_id: "turn".to_string(),
                item: Box::new(ThreadItemRecord {
                    id: "tool".to_string(),
                    turn_id: "turn".to_string(),
                    item_type: ThreadItemType::ToolCall,
                    status: ThreadItemStatus::InProgress,
                    content: json!({"command": "bun run test"}),
                    created_at: 1,
                    updated_at: 1,
                }),
            },
        ));
        handle_processes(&mut state).expect("process list");
        assert!(state
            .command_output
            .as_deref()
            .is_some_and(|output| output.contains("bun run test")));
        handle_raw(&mut state, vec!["on"]).expect("raw on");
        assert!(state.raw_output_mode);
        handle_raw(&mut state, vec!["off"]).expect("raw off");
        assert!(!state.raw_output_mode);
        handle_raw(&mut state, Vec::new()).expect("raw toggle");
        assert!(state.raw_output_mode);
        state.command_output = None;
        state.active_thread_id = None;
        state.threads.clear();
        handle_processes(&mut state).expect("empty process list");
        assert!(state.copyable_text().contains("No background"));

        state.command_output = None;
        handle_copy(&mut state).expect("empty copy");
        state.command_output = Some("copy me".into());
        handle_copy(&mut state).expect("successful copy");
        state.command_output = Some("__clipboard_error__".into());
        handle_copy(&mut state).expect("failed copy");
        assert!(state.copyable_text().contains("Clipboard unavailable"));
    }

    #[tokio::test]
    async fn stop_interrupts_active_thread() {
        let thread = json!({
            "id": "thread",
            "title": "Active",
            "objective": "Run checks",
            "state": "active",
            "archived": false,
            "source": "tui",
            "taskMode": "code",
            "parentThreadId": null,
            "turns": [{
                "id": "turn",
                "threadId": "thread",
                "runId": "run",
                "status": "interrupted",
                "items": [],
                "createdAt": 1,
                "updatedAt": 2
            }],
            "createdAt": 1,
            "updatedAt": 2
        });
        let (base_url, server) = start_rpc_sequence_server(vec![(
            "turn/interrupt",
            json!({
                "thread": thread,
                "turn": {
                    "id": "turn",
                    "threadId": "thread",
                    "runId": "run",
                    "status": "interrupted",
                    "items": [],
                    "createdAt": 1,
                    "updatedAt": 2
                },
                "run": {
                    "id": "run",
                    "prompt": "Run checks",
                    "modelId": null,
                    "projectId": null,
                    "status": "canceled",
                    "output": null,
                    "error": null,
                    "createdAt": 1,
                    "updatedAt": 2,
                    "toolEvents": [],
                    "sources": [],
                    "agentStatuses": [],
                    "pendingApproval": null
                }
            }),
        )]);
        let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
        let mut state = AppState::new(initialized_default_capabilities(), Vec::new());
        state.active_thread_id = Some("thread".to_string());

        handle_stop(&mut client, &mut state).await.expect("stop");

        assert_eq!(
            state
                .active_thread()
                .and_then(|thread| thread.turns.last())
                .map(|turn| turn.status),
            Some(TurnStatus::Interrupted)
        );
        server.join().expect("server");
    }

    #[tokio::test]
    async fn stop_cancels_selected_run_and_handles_empty_state() {
        let canceled = json!({
            "id":"run", "prompt":"Run checks", "modelId":null, "projectId":null,
            "status":"canceled", "output":null, "error":null, "createdAt":1, "updatedAt":2,
            "toolEvents":[], "sources":[], "agentStatuses":[], "pendingApproval":null
        });
        let (base_url, server) =
            start_rpc_sequence_server(vec![("run.cancel", json!({"run":canceled}))]);
        let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
        let run = serde_json::from_value(json!({
            "id":"run", "prompt":"Run checks", "modelId":null, "projectId":null,
            "status":"processing", "output":null, "error":null, "createdAt":1, "updatedAt":1,
            "toolEvents":[], "sources":[], "agentStatuses":[], "pendingApproval":null
        }))
        .expect("run");
        let mut state = AppState::new(initialized_default_capabilities(), vec![run]);
        handle_stop(&mut client, &mut state)
            .await
            .expect("cancel run");
        let mut empty = AppState::new(initialized_default_capabilities(), Vec::new());
        handle_stop(&mut client, &mut empty)
            .await
            .expect("empty stop");
        assert!(empty.copyable_text().contains("No active"));
        server.join().expect("server");
    }
}
