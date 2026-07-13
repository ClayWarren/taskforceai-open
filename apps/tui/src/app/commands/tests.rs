use futures_util::{stream::FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use taskforceai_app_client::AppServerClient;
use taskforceai_app_protocol::{RunRecord, RunStatus};

use super::{
    format_auto_update_status, format_realtime_voice_result, handle_local_command,
    handle_task_mode_command, parse_local_command, selected_speakable_text, LocalCommand,
};
use crate::app::{BackgroundTaskResult, UiTaskQueue};
use crate::state::{AppState, UiAction};
use crate::test_support::{initialized, start_rpc_sequence_server};
use crate::voice::{LISTEN_COMMAND_ENV, VOICE_ENV_TEST_LOCK};

fn run(id: &str, output: Option<&str>, error: Option<&str>) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        prompt: "prompt".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Completed,
        output: output.map(ToOwned::to_owned),
        error: error.map(ToOwned::to_owned),
        created_at: 1,
        updated_at: 1,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

fn status_summary() -> Value {
    json!({
        "transport": "http",
        "authenticated": true,
        "runCount": 1,
        "modelId": "sentinel",
        "quickMode": false,
        "autonomous": false,
        "computerUse": false,
        "pet": {
            "name": "Sentinel",
            "mood": "focus",
            "visible": true,
            "message": "Ready."
        }
    })
}

fn model_list(selected: Option<&str>) -> Value {
    json!({
        "enabled": true,
        "options": [
            {
                "id": "sentinel",
                "label": "Sentinel",
                "badge": "default",
                "description": "Default model",
                "usageMultiple": 1.0
            }
        ],
        "defaultModelId": "sentinel",
        "selectedModelId": selected,
        "remoteCatalog": false
    })
}

fn effort_model_list(
    selected: Option<&str>,
    include_selected: bool,
    levels: &[&str],
    default_effort: Option<&str>,
) -> Value {
    let options = if include_selected {
        vec![json!({
            "id": "openai/gpt-5.6-sol",
            "label": "GPT-5.6 Sol",
            "badge": "deep",
            "description": "Reasoning model",
            "usageMultiple": 1.0,
            "reasoningEffortLevels": levels,
            "defaultReasoningEffort": default_effort,
        })]
    } else {
        Vec::new()
    };
    json!({
        "enabled": true,
        "options": options,
        "defaultModelId": "openai/gpt-5.6-sol",
        "selectedModelId": selected,
        "remoteCatalog": false
    })
}

fn ollama_status() -> Value {
    json!({
        "providerId": "ollama",
        "baseUrl": "http://localhost:11434/v1",
        "hostRoot": "http://localhost:11434",
        "connected": true,
        "openaiCompatible": true,
        "responsesSupported": true,
        "version": "0.9.0",
        "models": ["ollama/gemma4:e4b"],
        "defaultModel": "ollama/gemma4:e4b",
        "memory": {
            "totalBytes": 17179869184_u64,
            "totalLabel": "16 GB",
            "recommendedModelId": "ollama/gemma4:e4b",
            "recommendedModel": "Gemma 4 E4B",
            "minimumBytes": 8589934592_u64,
            "reason": "Fits available memory"
        },
        "message": null
    })
}

fn hybrid_mode(enabled: bool) -> Value {
    json!({
        "enabled": enabled,
        "role": "Skeptic",
        "modelId": if enabled { json!("ollama/gemma4:e4b") } else { Value::Null },
        "recommendedModelId": "ollama/gemma4:e4b",
        "message": if enabled { "Hybrid reviewer enabled." } else { "Hybrid reviewer disabled." },
        "orchestration": {
            "roles": [
                {
                    "name": "Skeptic",
                    "description": "Reviews answers before completion.",
                    "modelId": if enabled { json!("ollama/gemma4:e4b") } else { Value::Null }
                }
            ],
            "budget": null
        }
    })
}

fn mcp_server_result(endpoint: &str) -> Value {
    json!({
        "server": {
            "name": "workspace",
            "endpoint": endpoint,
            "tools": [
                "read_file",
                "read_multiple_files",
                "write_file",
                "edit_file",
                "create_directory",
                "list_directory",
                "list_directory_with_sizes",
                "directory_tree",
                "move_file",
                "search_files",
                "get_file_info",
                "list_allowed_directories"
            ],
            "enabled": true
        }
    })
}

fn restore_env(key: &str, previous: Option<std::ffi::OsString>) {
    if let Some(previous) = previous {
        std::env::set_var(key, previous);
    } else {
        std::env::remove_var(key);
    }
}

async fn apply_next_background_task(state: &mut AppState, tasks: &mut UiTaskQueue) {
    let result = tasks
        .next()
        .await
        .expect("background task should be queued")
        .expect("background task should finish");
    match result {
        BackgroundTaskResult::Ui(action) => state.apply(*action),
        BackgroundTaskResult::RealtimeVoice(result) => {
            let (title, message) = format_realtime_voice_result(result);
            state.apply(UiAction::CommandOutputDisplayed { title, message });
        }
    }
}

#[test]
fn command_classifier_keeps_ui_only_commands_local() {
    assert_eq!(parse_local_command("/quit"), LocalCommand::Quit);
    assert_eq!(parse_local_command("/exit"), LocalCommand::Quit);
    assert_eq!(parse_local_command("/clear"), LocalCommand::Clear);
    assert_eq!(parse_local_command("/new"), LocalCommand::New);
}

#[test]
fn auto_update_status_formats_enabled_and_disabled_states() {
    assert_eq!(
        format_auto_update_status(None),
        "Auto-update is enabled for this process."
    );
    assert!(format_auto_update_status(Some("managed-install"))
        .starts_with("Auto-update disabled: managed-install"));
}

#[test]
fn command_classifier_preserves_args_for_local_handlers() {
    assert_eq!(
        parse_local_command("/login poll device-code"),
        LocalCommand::Login(vec!["poll", "device-code"])
    );
    assert_eq!(
        parse_local_command("/model set ollama/gemma4:31b"),
        LocalCommand::Model(vec!["set", "ollama/gemma4:31b"])
    );
    assert_eq!(
        parse_local_command("/effort xhigh"),
        LocalCommand::Effort(vec!["xhigh"])
    );
    assert_eq!(
        parse_local_command("/update apply"),
        LocalCommand::Update(vec!["apply"])
    );
    assert_eq!(parse_local_command("/usage"), LocalCommand::Usage);
    assert_eq!(
        parse_local_command("/private on"),
        LocalCommand::Private(vec!["on"])
    );
    assert_eq!(
        parse_local_command("/voice speak hello world"),
        LocalCommand::Voice(vec!["speak", "hello", "world"])
    );
    assert_eq!(
        parse_local_command("/ollama ensure gemma4:31b"),
        LocalCommand::Ollama(vec!["ensure", "gemma4:31b"])
    );
    assert_eq!(
        parse_local_command("/hybrid on ollama/gemma4:31b"),
        LocalCommand::Hybrid(vec!["on", "ollama/gemma4:31b"])
    );
    assert_eq!(
        parse_local_command("/code /tmp/workspace"),
        LocalCommand::Code(vec!["/tmp/workspace"])
    );
    assert_eq!(parse_local_command("/chat"), LocalCommand::Chat);
    assert_eq!(parse_local_command("/work"), LocalCommand::Work);
    assert_eq!(
        parse_local_command("/resume last"),
        LocalCommand::Resume(vec!["last"])
    );
    assert_eq!(
        parse_local_command("/fork thread-1"),
        LocalCommand::Fork(vec!["thread-1"])
    );
    assert_eq!(
        parse_local_command("/rename focused task"),
        LocalCommand::Rename(vec!["focused", "task"])
    );
    assert_eq!(
        parse_local_command("/archive"),
        LocalCommand::Archive(Vec::new())
    );
    assert_eq!(
        parse_local_command("/undo turn-1"),
        LocalCommand::Rollback(vec!["turn-1"])
    );
    assert_eq!(
        parse_local_command("/diff staged"),
        LocalCommand::Diff(vec!["staged"])
    );
    assert_eq!(
        parse_local_command("/review"),
        LocalCommand::Review(Vec::new())
    );
    assert_eq!(parse_local_command("/copy"), LocalCommand::Copy);
    assert_eq!(
        parse_local_command("/raw on"),
        LocalCommand::Raw(vec!["on"])
    );
    assert_eq!(parse_local_command("/ps"), LocalCommand::Processes);
    assert_eq!(parse_local_command("/stop"), LocalCommand::Stop);
}

#[tokio::test]
async fn thread_commands_resume_fork_rename_rollback_and_archive() {
    let thread = |id: &str, title: &str, archived: bool| {
        json!({
            "id": id,
            "title": title,
            "objective": "Ship safely",
            "state": "active",
            "archived": archived,
            "source": "tui",
            "taskMode": "work",
            "parentThreadId": null,
            "turns": [{
                "id": "turn-1",
                "threadId": id,
                "runId": "run-1",
                "status": "completed",
                "items": [],
                "createdAt": 1,
                "updatedAt": 2
            }],
            "createdAt": 1,
            "updatedAt": 2
        })
    };
    let resumed = thread("thread-1", "Original", false);
    let forked = thread("thread-2", "Original fork", false);
    let renamed = thread("thread-2", "Focused task", false);
    let archived = thread("thread-2", "Focused task", true);
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("thread/list", json!({"threads": [resumed.clone()]})),
        ("thread/resume", json!({"thread": resumed, "turn": null})),
        ("thread/fork", json!({"thread": forked, "turn": null})),
        (
            "thread/name/set",
            json!({"thread": renamed.clone(), "turn": null}),
        ),
        ("thread/rollback", json!({"thread": renamed, "turn": null})),
        ("thread/archive", json!({"thread": archived, "turn": null})),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks = UiTaskQueue::new();

    handle_local_command(&mut client, &mut state, "/resume thread-1", &mut tasks)
        .await
        .expect("resume");
    assert_eq!(state.active_thread_id.as_deref(), Some("thread-1"));
    assert_eq!(state.task_mode, crate::state::TaskMode::Work);
    handle_local_command(&mut client, &mut state, "/fork", &mut tasks)
        .await
        .expect("fork");
    assert_eq!(state.active_thread_id.as_deref(), Some("thread-2"));
    handle_local_command(&mut client, &mut state, "/rename Focused task", &mut tasks)
        .await
        .expect("rename");
    assert_eq!(state.active_thread().expect("thread").title, "Focused task");
    handle_local_command(&mut client, &mut state, "/rollback turn-1", &mut tasks)
        .await
        .expect("rollback");
    handle_local_command(&mut client, &mut state, "/archive", &mut tasks)
        .await
        .expect("archive");
    assert!(state.active_thread_id.is_none());
    assert!(state
        .threads
        .iter()
        .find(|thread| thread.id == "thread-2")
        .is_some_and(|thread| thread.archived));
    server.join().expect("rpc sequence should finish");
}

#[tokio::test]
async fn code_commands_show_diff_start_review_and_manage_attachments() {
    let diff = json!({
        "isGitRepository": true,
        "workspace": "/workspace",
        "repositoryRoot": "/workspace",
        "scope": "uncommitted",
        "baseRef": "main",
        "rawDiff": "diff --git a/a.rs b/a.rs\n+fixed",
        "files": [{"path": "a.rs", "oldPath": null, "status": "M"}],
        "truncated": false,
        "message": "Git diff loaded."
    });
    let status = json!({
        "isGitRepository": true,
        "workspace": "/workspace",
        "repositoryRoot": "/workspace",
        "branch": "feature",
        "head": "abc123",
        "upstream": "origin/feature",
        "baseRef": "main",
        "hasStagedChanges": false,
        "hasUnstagedChanges": true,
        "hasUntrackedFiles": false,
        "pullRequest": null,
        "files": [],
        "message": "Git repository detected."
    });
    let thread = json!({
        "id": "review-thread",
        "title": "Review changes",
        "objective": "Review changes",
        "state": "active",
        "archived": false,
        "source": "tui",
        "taskMode": "code",
        "parentThreadId": null,
        "turns": [],
        "createdAt": 1,
        "updatedAt": 1
    });
    let turn = json!({
        "id": "review-turn",
        "threadId": "review-thread",
        "runId": "review-run",
        "status": "in_progress",
        "items": [],
        "createdAt": 1,
        "updatedAt": 1
    });
    let mut active_thread = thread.clone();
    active_thread["turns"] = json!([turn.clone()]);
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("git.review.diff", diff.clone()),
        ("git.review.status", status),
        ("git.review.diff", diff),
        ("thread/start", json!({"thread": thread, "turn": null})),
        (
            "turn/start",
            json!({
                "thread": active_thread,
                "turn": turn,
                "run": {
                    "id": "review-run",
                    "prompt": "review",
                    "modelId": null,
                    "projectId": null,
                    "status": "processing",
                    "output": null,
                    "error": null,
                    "createdAt": 1,
                    "updatedAt": 1,
                    "toolEvents": [],
                    "sources": [],
                    "agentStatuses": [],
                    "pendingApproval": null
                }
            }),
        ),
        (
            "attachment.add",
            json!({
                "attachment": {"id": "att-1", "name": "notes.txt", "path": "/tmp/notes.txt", "mimeType": "text/plain", "size": 12},
                "attachments": [{"id": "att-1", "name": "notes.txt", "path": "/tmp/notes.txt", "mimeType": "text/plain", "size": 12}],
                "maxAttachments": 5
            }),
        ),
        (
            "attachment.clear",
            json!({"attachments": [], "maxAttachments": 5}),
        ),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    state.task_mode = crate::state::TaskMode::Code;
    state.workspace = Some("/workspace".to_string());
    let mut tasks = UiTaskQueue::new();

    handle_local_command(&mut client, &mut state, "/diff", &mut tasks)
        .await
        .expect("diff");
    assert!(state.copyable_text().contains("diff --git"));
    handle_local_command(&mut client, &mut state, "/review", &mut tasks)
        .await
        .expect("review");
    assert_eq!(state.active_thread_id.as_deref(), Some("review-thread"));
    assert_eq!(state.task_mode, crate::state::TaskMode::Code);
    handle_local_command(
        &mut client,
        &mut state,
        "/attach /tmp/notes.txt",
        &mut tasks,
    )
    .await
    .expect("attach");
    assert_eq!(state.attachments.len(), 1);
    handle_local_command(&mut client, &mut state, "/attach clear", &mut tasks)
        .await
        .expect("clear attachments");
    assert!(state.attachments.is_empty());
    server.join().expect("rpc sequence should finish");
}

#[tokio::test]
async fn code_command_edges_cover_scopes_empty_results_and_mode_guards() {
    let empty_diff = |truncated: bool| {
        json!({
            "isGitRepository": true, "workspace": "/workspace", "repositoryRoot": "/workspace",
            "scope": "uncommitted", "baseRef": "main", "rawDiff": "", "files": [],
            "truncated": truncated, "message": "No diff"
        })
    };
    let not_repo = json!({
        "isGitRepository": false, "workspace": "/workspace", "repositoryRoot": null,
        "branch": null, "head": null, "upstream": null, "baseRef": null,
        "hasStagedChanges": false, "hasUnstagedChanges": false, "hasUntrackedFiles": false,
        "pullRequest": null, "files": [], "message": "Not a repository"
    });
    let repo = json!({
        "isGitRepository": true, "workspace": "/workspace", "repositoryRoot": "/workspace",
        "branch": null, "head": "abc", "upstream": null, "baseRef": "main",
        "hasStagedChanges": false, "hasUnstagedChanges": false, "hasUntrackedFiles": false,
        "pullRequest": null, "files": [], "message": "Repository"
    });
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("git.review.diff", empty_diff(true)),
        ("git.review.diff", empty_diff(false)),
        ("git.review.diff", empty_diff(false)),
        ("git.review.status", not_repo),
        ("git.review.status", repo),
        ("git.review.diff", empty_diff(false)),
        (
            "workspace.file.list",
            json!({"workspace":"/workspace", "files": [], "truncated":false}),
        ),
        (
            "workspace.file.list",
            json!({"workspace":"/workspace", "files": ["src/main.rs", "src/lib.rs"], "truncated":false}),
        ),
        (
            "attachment.list",
            json!({"attachments": [], "maxAttachments": 5}),
        ),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks = UiTaskQueue::new();

    for command in ["/diff", "/review", "/mention"] {
        handle_local_command(&mut client, &mut state, command, &mut tasks)
            .await
            .expect("Code-mode guard");
        assert!(state.copyable_text().contains("Code-mode command"));
    }
    state.task_mode = crate::state::TaskMode::Code;
    state.workspace = Some("/workspace".into());
    for command in ["/diff staged main", "/diff unstaged", "/diff branch main"] {
        handle_local_command(&mut client, &mut state, command, &mut tasks)
            .await
            .expect("diff scope");
    }
    handle_local_command(&mut client, &mut state, "/review", &mut tasks)
        .await
        .expect("non-repository review");
    handle_local_command(&mut client, &mut state, "/review all main", &mut tasks)
        .await
        .expect("empty review");
    handle_local_command(&mut client, &mut state, "/mention missing", &mut tasks)
        .await
        .expect("missing mention");
    handle_local_command(&mut client, &mut state, "/mention src", &mut tasks)
        .await
        .expect("mention match");
    assert_eq!(state.prompt_input, "@src/main.rs ");
    handle_local_command(&mut client, &mut state, "/attach list", &mut tasks)
        .await
        .expect("attachment list");
    server.join().expect("RPC sequence");
}

#[tokio::test]
async fn thread_command_edges_report_missing_targets_and_turns() {
    let (base_url, server) =
        start_rpc_sequence_server(vec![("thread/list", json!({"threads": []}))]);
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks = UiTaskQueue::new();

    for command in [
        "/resume",
        "/fork",
        "/rename",
        "/rename New title",
        "/archive",
        "/rollback",
    ] {
        handle_local_command(&mut client, &mut state, command, &mut tasks)
            .await
            .expect("missing thread edge");
    }
    state.set_active_thread(
        serde_json::from_value(json!({
            "id":"thread", "title":"Empty", "objective":"", "state":"active",
            "archived":false, "source":"test", "taskMode":"chat", "parentThreadId":null,
            "turns":[], "createdAt":1, "updatedAt":1
        }))
        .expect("thread"),
    );
    handle_local_command(&mut client, &mut state, "/rollback", &mut tasks)
        .await
        .expect("missing turn edge");
    assert!(state.copyable_text().contains("no turns"));
    server.join().expect("RPC sequence");
}

#[tokio::test]
async fn terminal_command_dispatch_covers_copy_raw_processes_and_empty_stop() {
    let (base_url, server) = start_rpc_sequence_server(Vec::new());
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks = UiTaskQueue::new();
    for command in ["/copy", "/raw", "/ps", "/stop"] {
        handle_local_command(&mut client, &mut state, command, &mut tasks)
            .await
            .expect("terminal command");
    }
    server.join().expect("empty server");
}

#[test]
fn private_command_args_parse_toggle_set_and_status() {
    assert_eq!(
        super::parse_private_command_args(&[], false).expect("toggle on"),
        Some(true)
    );
    assert_eq!(
        super::parse_private_command_args(&[], true).expect("toggle off"),
        Some(false)
    );
    assert_eq!(
        super::parse_private_command_args(&["on"], false).expect("set on"),
        Some(true)
    );
    assert_eq!(
        super::parse_private_command_args(&["off"], true).expect("set off"),
        Some(false)
    );
    assert_eq!(
        super::parse_private_command_args(&["status"], true).expect("status"),
        None
    );
    assert!(super::parse_private_command_args(&["banana"], false).is_err());
}

#[test]
fn command_classifier_falls_back_to_app_server_for_unknown_slash_commands() {
    assert_eq!(
        parse_local_command("/status"),
        LocalCommand::AppServerCommand
    );
    assert_eq!(
        parse_local_command("/mcp list"),
        LocalCommand::AppServerCommand
    );
    assert_eq!(parse_local_command("plain prompt"), LocalCommand::Prompt);
    assert_eq!(parse_local_command(""), LocalCommand::Prompt);
}

#[test]
fn selected_speakable_text_prefers_selected_run_output_then_error_then_command_output() {
    let mut state = AppState::new(initialized(), vec![run("r1", Some("answer"), None)]);
    state.apply(UiAction::CommandExecuted {
        title: "Status".to_string(),
        message: "ok".to_string(),
    });

    assert_eq!(selected_speakable_text(&state), "answer");

    state.apply(UiAction::HistoryLoaded(vec![run(
        "r2",
        None,
        Some("failed"),
    )]));
    assert_eq!(selected_speakable_text(&state), "failed");

    state.apply(UiAction::HistoryLoaded(Vec::new()));
    state.command_output = Some("Status\nok".to_string());
    assert_eq!(selected_speakable_text(&state), "Status\nok");
}

#[tokio::test]
async fn private_command_requires_auth_when_enabling() {
    let (base_url, server) = start_rpc_sequence_server(vec![(
        "auth.status",
        json!({"authenticated": false, "user": null}),
    )]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert!(
        handle_local_command(&mut client, &mut state, "/private on", &mut tasks)
            .await
            .expect("private command should handle unauthenticated state")
    );

    assert!(!state.private_chat_enabled);
    assert_eq!(
        state.command_output.as_deref(),
        Some("Login Required\nNot authenticated. Use /login first.")
    );
    server.join().expect("private auth rpc should finish");
}

#[tokio::test]
async fn private_command_toggles_after_auth_and_reports_status() {
    let (base_url, server) = start_rpc_sequence_server(vec![(
        "auth.status",
        json!({"authenticated": true, "user": {"id": "u1"}}),
    )]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert!(
        handle_local_command(&mut client, &mut state, "/private", &mut tasks)
            .await
            .expect("private command should enable")
    );
    assert!(state.private_chat_enabled);
    assert_eq!(state.status_line, "Private Chat enabled");
    assert!(state
        .command_output
        .as_deref()
        .expect("private command output")
        .contains("won't appear in your history"));

    assert!(
        handle_local_command(&mut client, &mut state, "/private status", &mut tasks)
            .await
            .expect("private status should render")
    );
    assert!(state.private_chat_enabled);
    assert!(state
        .command_output
        .as_deref()
        .expect("private status output")
        .contains("Enabled."));

    assert!(
        handle_local_command(&mut client, &mut state, "/private off", &mut tasks)
            .await
            .expect("private command should disable")
    );
    assert!(!state.private_chat_enabled);
    assert_eq!(state.status_line, "Private Chat disabled");

    server.join().expect("private auth rpc should finish");
}

#[tokio::test]
async fn private_command_reports_disabled_status_and_invalid_args() {
    let (base_url, server) = start_rpc_sequence_server(Vec::new());
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert!(
        handle_local_command(&mut client, &mut state, "/private status", &mut tasks)
            .await
            .expect("private status should be local")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Private Chat\nDisabled. Use /private on to start a private chat.")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/private maybe", &mut tasks)
            .await
            .expect("invalid private args should render usage")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Private Chat\nUsage: /private [on|off|status]")
    );

    server.join().expect("unused rpc server should finish");
}

#[tokio::test]
async fn effort_command_covers_catalog_status_selection_and_validation() {
    let supported = || {
        effort_model_list(
            Some("openai/gpt-5.6-sol"),
            true,
            &["low", "medium", "high"],
            Some("medium"),
        )
    };
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "model.list",
            effort_model_list(Some("openai/gpt-5.6-sol"), false, &[], None),
        ),
        (
            "model.list",
            effort_model_list(Some("openai/gpt-5.6-sol"), true, &[], None),
        ),
        ("model.list", supported()),
        ("model.list", supported()),
        ("model.list", supported()),
        ("model.list", supported()),
        ("model.list", supported()),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    for (command, expected) in [
        ("/effort", "not present in the model catalog"),
        ("/effort", "does not expose configurable reasoning effort"),
        ("/effort reset", "Selected model default"),
        ("/effort status", "Selected: medium"),
        ("/effort high", "Selected high"),
        ("/effort impossible", "Unsupported effort"),
    ] {
        assert!(
            handle_local_command(&mut client, &mut state, command, &mut tasks)
                .await
                .expect("effort command should be handled")
        );
        assert!(
            state
                .command_output
                .as_deref()
                .expect("effort output")
                .contains(expected),
            "unexpected output for {command}: {:?}",
            state.command_output
        );
    }

    state.reasoning_effort = Some("high".to_string());
    assert!(
        handle_local_command(&mut client, &mut state, "/effort select", &mut tasks)
            .await
            .expect("effort selector should open")
    );
    assert!(state.effort_selector_active());
    assert_eq!(state.selected_effort(), Some("high"));

    server.join().expect("effort rpc sequence should finish");
}

#[tokio::test]
async fn local_command_handlers_drive_app_server_rpc_and_update_state() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("model.list", model_list(None)),
        ("model.select", model_list(Some("gpt-5"))),
        ("ollama.status", ollama_status()),
        (
            "ollama.ensure",
            json!({
                "status": ollama_status(),
                "model": "ollama/gemma4:e4b",
                "pulled": true,
                "pullEvents": [{"type": "success"}]
            }),
        ),
        ("hybridMode.get", hybrid_mode(false)),
        ("hybridMode.set", hybrid_mode(true)),
        ("hybridMode.set", hybrid_mode(false)),
        (
            "auth.devicePoll",
            json!({
                "status": "approved",
                "token": "token",
                "expiresIn": 3600,
                "interval": 5,
                "message": "Approved"
            }),
        ),
        (
            "usage.summary",
            json!({
                "totalRuns": 7,
                "completedRuns": 4,
                "canceledRuns": 1,
                "failedRuns": 1,
                "queuedRuns": 1,
                "processingRuns": 0
            }),
        ),
        (
            "command.execute",
            json!({
                "handled": true,
                "title": "Status",
                "message": "App-server ok"
            }),
        ),
        ("status.summary", status_summary()),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert!(
        handle_local_command(&mut client, &mut state, "/model list", &mut tasks)
            .await
            .expect("model list should succeed")
    );
    assert!(state.model_selector_active());

    assert!(
        handle_local_command(&mut client, &mut state, "/model set gpt-5", &mut tasks)
            .await
            .expect("model select should succeed")
    );
    assert_eq!(state.current_model_id, "gpt-5");
    assert!(state
        .command_output
        .as_deref()
        .expect("model command output")
        .contains("gpt-5"));

    assert!(
        handle_local_command(&mut client, &mut state, "/ollama status", &mut tasks)
            .await
            .expect("ollama status should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("ollama status output")
        .contains("connected: true"));

    assert!(handle_local_command(
        &mut client,
        &mut state,
        "/ollama ensure ollama/gemma4:e4b",
        &mut tasks,
    )
    .await
    .expect("ollama ensure should succeed"));
    assert!(state
        .command_output
        .as_deref()
        .expect("ollama ensure output")
        .contains("pulled: true"));

    assert!(
        handle_local_command(&mut client, &mut state, "/hybrid status", &mut tasks)
            .await
            .expect("hybrid status should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("hybrid status output")
        .contains("enabled: false"));

    assert!(handle_local_command(
        &mut client,
        &mut state,
        "/hybrid on ollama/gemma4:e4b",
        &mut tasks,
    )
    .await
    .expect("hybrid enable should succeed"));
    assert!(state
        .command_output
        .as_deref()
        .expect("hybrid enable output")
        .contains("enabled: true"));

    assert!(
        handle_local_command(&mut client, &mut state, "/hybrid off", &mut tasks)
            .await
            .expect("hybrid disable should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("hybrid disable output")
        .contains("enabled: false"));

    assert!(
        handle_local_command(&mut client, &mut state, "/login poll device", &mut tasks)
            .await
            .expect("login poll should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("login output")
        .contains("Approved"));

    assert!(
        handle_local_command(&mut client, &mut state, "/usage", &mut tasks)
            .await
            .expect("usage command should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("usage output")
        .contains("total runs: 7"));
    assert!(state
        .command_output
        .as_deref()
        .expect("usage output")
        .contains("queued: 1"));

    assert!(
        handle_local_command(&mut client, &mut state, "/status", &mut tasks)
            .await
            .expect("delegated command should succeed")
    );
    assert_eq!(state.current_model_id, "sentinel");
    assert!(state
        .command_output
        .as_deref()
        .expect("status output")
        .contains("App-server ok"));

    server.join().expect("rpc sequence should finish");
}

#[tokio::test]
async fn local_command_handlers_cover_ui_only_and_usage_branches() {
    let (base_url, server) = start_rpc_sequence_server(Vec::new());
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert!(
        handle_local_command(&mut client, &mut state, "/new", &mut tasks)
            .await
            .expect("new command should succeed")
    );
    assert_eq!(state.status_line, "New prompt");
    assert!(
        !handle_local_command(&mut client, &mut state, "plain prompt", &mut tasks)
            .await
            .expect("plain prompt should not be handled locally")
    );

    state.prompt_input = "text".to_string();
    state.command_output = Some("output".to_string());
    assert!(
        handle_local_command(&mut client, &mut state, "/clear", &mut tasks)
            .await
            .expect("clear command should succeed")
    );
    assert_eq!(state.prompt_input, "");
    assert_eq!(state.command_output, None);

    assert!(
        handle_local_command(&mut client, &mut state, "/update auto", &mut tasks)
            .await
            .expect("update auto command should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("update auto output")
        .contains("Auto-update"));

    assert!(
        handle_local_command(&mut client, &mut state, "/update banana", &mut tasks)
            .await
            .expect("invalid update command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Update\nUsage: /update [check|apply|auto]")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/voice status", &mut tasks)
            .await
            .expect("voice status command should succeed")
    );
    assert!(state
        .command_output
        .as_deref()
        .expect("voice status output")
        .contains("Voice"));

    state.command_output = None;
    assert!(
        handle_local_command(&mut client, &mut state, "/voice speak", &mut tasks)
            .await
            .expect("empty voice speak command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Voice\nNothing to speak.")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/voice nope", &mut tasks)
            .await
            .expect("invalid voice command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Voice\nUsage: /voice [status|listen|replace|realtime|speak <text>|cancel]")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/model set", &mut tasks)
            .await
            .expect("empty model set command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Model\nUsage: /model set <model-id>")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/login poll", &mut tasks)
            .await
            .expect("missing login poll device code should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Login\nUsage: /login poll <device-code>")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/ollama nope", &mut tasks)
            .await
            .expect("invalid ollama command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Ollama\nUsage: /ollama [status|recommend|ensure [model]]")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/hybrid nope", &mut tasks)
            .await
            .expect("invalid hybrid command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Hybrid\nUsage: /hybrid [status|on [ollama/model]|off]")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/code", &mut tasks)
            .await
            .expect("empty code command should succeed")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Code\nUsage: /code <project-directory>")
    );

    assert!(
        handle_local_command(&mut client, &mut state, "/quit", &mut tasks)
            .await
            .expect("quit command should succeed")
    );
    assert!(state.should_quit);

    server.join().expect("empty rpc sequence should finish");
}

#[tokio::test]
async fn local_model_and_code_commands_cover_reset_shorthand_and_workspace_success() {
    let workspace = tempfile::tempdir().expect("workspace temp dir");
    let workspace_path = workspace.path().canonicalize().expect("workspace path");
    let endpoint = format!(
        "stdio:bunx @modelcontextprotocol/server-filesystem \"{}\"",
        workspace_path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    );
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("model.reset", model_list(None)),
        ("model.select", model_list(Some("claude-sonnet"))),
        ("mcp.add", mcp_server_result(&endpoint)),
        ("mcp.tools", mcp_server_result(&endpoint)),
        ("quickMode.set", json!({"enabled": false})),
        ("autonomousMode.set", json!({"enabled": false})),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    handle_local_command(&mut client, &mut state, "/model reset", &mut tasks)
        .await
        .expect("model reset should succeed");
    assert_eq!(state.current_model_id, "sentinel");

    handle_local_command(&mut client, &mut state, "/model claude-sonnet", &mut tasks)
        .await
        .expect("model shorthand should select");
    assert_eq!(state.current_model_id, "claude-sonnet");

    handle_local_command(
        &mut client,
        &mut state,
        &format!("/code {}", workspace_path.display()),
        &mut tasks,
    )
    .await
    .expect("code workspace command should enable tools");
    assert!(state
        .command_output
        .as_deref()
        .expect("code output")
        .contains("Workspace tools enabled"));
    assert_eq!(state.task_mode.label(), "code");

    server
        .join()
        .expect("model/code rpc sequence should finish");
}

#[tokio::test]
async fn chat_and_work_commands_switch_modes_without_changing_the_default() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("mcp.remove", json!({"ok": true})),
        ("quickMode.set", json!({"enabled": false})),
        ("autonomousMode.set", json!({"enabled": false})),
        ("mcp.remove", json!({"ok": true})),
        ("quickMode.set", json!({"enabled": true})),
        ("autonomousMode.set", json!({"enabled": false})),
        ("mcp.remove", json!({"ok": true})),
        ("quickMode.set", json!({"enabled": false})),
        ("autonomousMode.set", json!({"enabled": false})),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    assert_eq!(state.task_mode, crate::state::TaskMode::Chat);
    handle_local_command(&mut client, &mut state, "/work", &mut tasks)
        .await
        .expect("work mode should enable");
    assert_eq!(state.task_mode, crate::state::TaskMode::Work);
    assert!(state
        .command_output
        .as_deref()
        .is_some_and(|output| output.contains("Agent Teams remains off")));

    handle_local_command(&mut client, &mut state, "/chat", &mut tasks)
        .await
        .expect("chat mode should enable");
    assert_eq!(state.task_mode, crate::state::TaskMode::Chat);

    handle_task_mode_command(&mut client, &mut state, crate::state::TaskMode::Code)
        .await
        .expect("code mode message");
    assert!(state
        .copyable_text()
        .contains("Workspace Code mode enabled"));

    server.join().expect("mode rpc sequence should finish");
}

#[allow(clippy::await_holding_lock)]
#[tokio::test(flavor = "current_thread")]
async fn local_voice_commands_cover_dictation_speech_and_realtime_errors() {
    let _guard = VOICE_ENV_TEST_LOCK.lock().expect("voice env test lock");
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "voice.speechGenerate",
            json!({
                "audioBase64": "",
                "mediaType": "audio/mpeg",
                "format": "mp3"
            }),
        ),
        (
            "voice.realtimeSetup",
            json!({
                "token": "",
                "url": "",
                "expiresAt": null,
                "tools": null
            }),
        ),
    ]);
    let mut client = AppServerClient::connect_http(base_url, "session-token")
        .expect("test client should connect");
    let mut state = AppState::new(initialized(), Vec::new());
    let mut tasks: UiTaskQueue = FuturesUnordered::new();

    let previous = std::env::var_os(LISTEN_COMMAND_ENV);
    std::env::set_var(LISTEN_COMMAND_ENV, "printf ' dictated text\\n'");
    handle_local_command(&mut client, &mut state, "/voice listen", &mut tasks)
        .await
        .expect("voice listen command should succeed");
    assert_eq!(state.command_output.as_deref(), Some("Voice\nListening..."));
    apply_next_background_task(&mut state, &mut tasks).await;
    restore_env(LISTEN_COMMAND_ENV, previous);
    assert_eq!(state.prompt_input, "dictated text");

    state.prompt_input = "replace me".to_string();
    let previous = std::env::var_os(LISTEN_COMMAND_ENV);
    std::env::set_var(LISTEN_COMMAND_ENV, "printf 'replacement\\n'");
    handle_local_command(&mut client, &mut state, "/voice replace", &mut tasks)
        .await
        .expect("voice replace command should succeed");
    apply_next_background_task(&mut state, &mut tasks).await;
    restore_env(LISTEN_COMMAND_ENV, previous);
    assert_eq!(state.prompt_input, "replacement");

    handle_local_command(&mut client, &mut state, "/voice speak hello", &mut tasks)
        .await
        .expect("voice speak command should handle playback error");
    assert!(state
        .command_output
        .as_deref()
        .expect("voice speak output")
        .contains("empty audio"));

    handle_local_command(&mut client, &mut state, "/voice realtime", &mut tasks)
        .await
        .expect("voice realtime command should handle setup error");
    assert_eq!(
        state.command_output.as_deref(),
        Some("Voice\nRealtime voice turn is listening...")
    );
    apply_next_background_task(&mut state, &mut tasks).await;
    assert!(state
        .command_output
        .as_deref()
        .expect("voice realtime output")
        .contains("invalid session data"));

    server.join().expect("voice rpc sequence should finish");
}
