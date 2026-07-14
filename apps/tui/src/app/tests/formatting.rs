use super::*;

#[test]
fn after_response_dispatch_triggers_only_for_completed_runs() {
    let mut run = RunRecord {
        id: "run_1".to_string(),
        prompt: "hello".to_string(),
        model_id: None,
        project_id: None,
        status: RunStatus::Processing,
        output: None,
        error: None,
        created_at: 1,
        updated_at: 2,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    };

    assert_eq!(
        after_response_conversation_id(&AppServerEvent::RunUpdated {
            run: Box::new(run.clone())
        }),
        None
    );
    run.status = RunStatus::Completed;
    assert_eq!(
        after_response_conversation_id(&AppServerEvent::RunUpdated { run: Box::new(run) }),
        Some("run_1".to_string())
    );
    assert_eq!(
        after_response_conversation_id(&AppServerEvent::RunDeleted {
            run_id: "run_1".to_string()
        }),
        None
    );
}

#[tokio::test]
async fn code_mentions_are_expanded_through_app_server_file_reads() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "workspace.file.read",
            json!({
                "workspace": "/workspace",
                "path": "src/app.rs",
                "content": "fn main() {}",
                "truncated": false,
                "binary": false
            }),
        ),
        (
            "workspace.file.read",
            json!({
                "workspace": "/workspace",
                "path": "docs/road map}.md",
                "content": "# Road map",
                "truncated": false,
                "binary": false
            }),
        ),
    ]);
    let client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.task_mode = crate::state::TaskMode::Code;
    state.workspace = Some("/workspace".to_string());

    let expanded = expand_workspace_mentions(&client, &state, "Review @src/app.rs").await;

    assert!(expanded.contains("<workspace_file path=\"src/app.rs\">"));
    assert!(expanded.contains("fn main() {}"));
    let expanded =
        expand_workspace_mentions(&client, &state, "Review @{docs/road map\\}.md}").await;
    assert!(expanded.contains("<workspace_file path=\"docs/road map}.md\">"));
    assert!(expanded.contains("# Road map"));
    server.join().expect("server");
}

#[tokio::test]
async fn mention_expansion_covers_binary_truncated_missing_and_non_code_paths() {
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "workspace.file.read",
            json!({
                "workspace":"/workspace", "path":"image.png", "content":"",
                "truncated":false, "binary":true
            }),
        ),
        (
            "workspace.file.read",
            json!({
                "workspace":"/workspace", "path":"large.rs", "content":"partial",
                "truncated":true, "binary":false
            }),
        ),
    ]);
    let client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    assert_eq!(
        expand_workspace_mentions(&client, &state, "Review @ignored.rs").await,
        "Review @ignored.rs"
    );
    state.task_mode = crate::state::TaskMode::Code;
    state.workspace = Some("/workspace".into());
    assert_eq!(
        expand_workspace_mentions(&client, &state, "No mentions").await,
        "No mentions"
    );
    let expanded =
        expand_workspace_mentions(&client, &state, "Review @image.png, @large.rs; @image.png")
            .await;
    assert!(expanded.contains("binary=\"true\""));
    assert!(expanded.contains("truncated=\"true\""));
    server.join().expect("file reads");

    let unavailable =
        AppServerClient::connect_http("http://127.0.0.1:1", "token").expect("client construction");
    assert_eq!(
        expand_workspace_mentions(&unavailable, &state, "Review @missing.rs").await,
        "Review @missing.rs"
    );
}

#[tokio::test]
async fn server_interactions_events_and_file_suggestions_cover_transport_edges() {
    let (base_url, sink) = start_http_sink_server(3);
    let mut client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state
        .open_interaction(taskforceai_app_protocol::JsonRpcServerRequest {
            jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
            id: json!(7),
            method: "item/commandExecution/requestApproval".into(),
            params: json!({
                "threadId":"t", "turnId":"u", "itemId":"i", "reason":"Run",
                "command":["bun","test"]
            }),
        })
        .expect("approval");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        Rect::new(0, 0, 80, 20),
        &mut UiTaskQueue::new(),
        &mut SpaceDictationState::Idle,
    )
    .await
    .expect("approval response");

    state
        .open_interaction(taskforceai_app_protocol::JsonRpcServerRequest {
            jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
            id: json!(9),
            method: "item/tool/requestUserInput".into(),
            params: json!({
                "threadId":"t", "turnId":"u", "itemId":"i",
                "questions":[{"id":"note","header":"Note","question":"Text","options":[]}]
            }),
        })
        .expect("text input");
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::SubmitPrompt,
        Rect::new(0, 0, 80, 20),
        &mut UiTaskQueue::new(),
        &mut SpaceDictationState::Idle,
    )
    .await
    .expect("invalid interaction stays open");
    assert!(state.status_line.contains("Type an answer"));
    handle_input_action(
        &mut client,
        &mut state,
        InputAction::Quit,
        Rect::new(0, 0, 80, 20),
        &mut UiTaskQueue::new(),
        &mut SpaceDictationState::Idle,
    )
    .await
    .expect("interaction cancellation response");

    handle_app_server_event(
        &client,
        &mut state,
        AppServerEvent::ServerRequest {
            request: taskforceai_app_protocol::JsonRpcServerRequest {
                jsonrpc: taskforceai_app_protocol::JSONRPC_VERSION.to_string(),
                id: json!(8),
                method: "item/tool/call".into(),
                params: json!({}),
            },
        },
    )
    .await
    .expect("dynamic tool rejection");
    handle_app_server_event(
        &client,
        &mut state,
        AppServerEvent::RunDeleted {
            run_id: "missing".into(),
        },
    )
    .await
    .expect("ordinary event");
    assert_eq!(sink.join().expect("sink responses").len(), 3);

    state.task_mode = crate::state::TaskMode::Chat;
    refresh_file_suggestions(&client, &mut state).await;
    state.task_mode = crate::state::TaskMode::Code;
    state.clear_prompt();
    refresh_file_suggestions(&client, &mut state).await;
    state.paste_prompt("@missing");
    refresh_file_suggestions(&client, &mut state).await;
    assert!(state.file_suggestions.is_empty());
}

#[tokio::test]
async fn chat_task_submission_reuses_threads_and_file_refresh_returns_matches() {
    let thread = |turns: Value| {
        json!({
            "id":"chat-thread", "title":"Chat", "objective":"Hello", "state":"active",
            "archived":false, "source":"tui", "taskMode":"chat", "parentThreadId":null,
            "turns":turns, "createdAt":1, "updatedAt":2
        })
    };
    let turn = |id: &str| {
        json!({
            "id":id, "threadId":"chat-thread", "runId":format!("run-{id}"),
            "status":"in_progress", "items":[], "createdAt":1, "updatedAt":2
        })
    };
    let run = |id: &str| {
        json!({
            "id":id, "prompt":"Hello", "modelId":null, "projectId":null,
            "status":"processing", "output":null, "error":null, "createdAt":1, "updatedAt":2,
            "toolEvents":[], "sources":[], "agentStatuses":[], "pendingApproval":null
        })
    };
    let first_turn = turn("turn-1");
    let second_turn = turn("turn-2");
    let (base_url, server) = start_rpc_sequence_server(vec![
        (
            "thread/start",
            json!({"thread":thread(json!([])), "turn":null}),
        ),
        (
            "turn/start",
            json!({"thread":thread(json!([first_turn.clone()])), "turn":first_turn, "run":run("run-turn-1")}),
        ),
        (
            "turn/start",
            json!({"thread":thread(json!([second_turn.clone()])), "turn":second_turn, "run":run("run-turn-2")}),
        ),
    ]);
    let client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.task_mode = crate::state::TaskMode::Chat;
    submit_task_prompt(&client, &mut state, "Hello".into())
        .await
        .expect("new chat thread");
    submit_task_prompt(&client, &mut state, "Again".into())
        .await
        .expect("existing chat thread");
    assert_eq!(state.status_line, "Submitted prompt");
    server.join().expect("chat RPCs");

    let (base_url, files_server) = start_rpc_sequence_server(vec![(
        "workspace.file.list",
        json!({"workspace":"/workspace", "files":["src/main.rs"], "truncated":false}),
    )]);
    let client = AppServerClient::connect_http(base_url, "session-token").expect("client");
    state.task_mode = crate::state::TaskMode::Code;
    state.workspace = Some("/workspace".into());
    state.paste_prompt("@main");
    refresh_file_suggestions(&client, &mut state).await;
    assert_eq!(state.file_suggestions, vec!["src/main.rs"]);
    files_server.join().expect("file RPC");
}

#[test]
fn interactive_rpc_errors_render_without_quitting() {
    let mut state = crate::state::AppState::new(initialized(), Vec::new());
    state.prompt_input = "preserve this prompt".to_string();

    apply_interactive_error(
        &mut state,
        AppClientError::Rpc {
            code: -32030,
            message: "api error: api returned status 403".to_string(),
        },
    );

    assert!(!state.should_quit);
    assert_eq!(state.status_line, "Command failed");
    assert_eq!(state.prompt_input, "preserve this prompt");
    assert_eq!(
        state.command_output.as_deref(),
        Some("Error\nRequest failed (-32030): api error: api returned status 403")
    );

    apply_interactive_error(&mut state, AppClientError::Closed);
    assert_eq!(state.status_line, "Command failed");
    assert!(state
        .command_output
        .as_deref()
        .expect("closed output")
        .starts_with("Error\n"));
}

#[test]
fn formats_model_list_with_selection_and_usage() {
    let result = ModelListResult {
        enabled: true,
        options: vec![
            ModelOptionRecord {
                id: "model-a".to_string(),
                label: "Model A".to_string(),
                badge: "fast".to_string(),
                description: Some("Fast path".to_string()),
                usage_multiple: Some(1.5),
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
            ModelOptionRecord {
                id: "model-b".to_string(),
                label: "Model B".to_string(),
                badge: "deep".to_string(),
                description: None,
                usage_multiple: None,
                reasoning_effort_levels: Vec::new(),
                default_reasoning_effort: None,
            },
        ],
        default_model_id: "model-a".to_string(),
        selected_model_id: Some("model-b".to_string()),
        remote_catalog: true,
    };

    assert_eq!(
        format_model_list(&result),
        "selected: model-b\ncatalog: remote\n- model-a [fast] - Fast path (1.5x)\n* model-b [deep]"
    );
}

#[test]
fn formats_ollama_status_with_memory_recommendation() {
    let result = OllamaStatusResult {
        provider_id: "ollama".to_string(),
        base_url: "http://localhost:11434/v1".to_string(),
        host_root: "http://localhost:11434".to_string(),
        connected: true,
        openai_compatible: true,
        responses_supported: Some(true),
        version: Some("0.12.0".to_string()),
        models: vec!["gemma4:31b".to_string()],
        default_model: "gemma4:31b".to_string(),
        memory: OllamaMemoryRecommendation {
            total_bytes: Some(34_359_738_368),
            total_label: "32.0 GiB".to_string(),
            recommended_model_id: "ollama/gemma4:31b".to_string(),
            recommended_model: "gemma4:31b".to_string(),
            minimum_bytes: 25_769_803_776,
            reason: "Detected enough memory for Gemma 4 31B.".to_string(),
        },
        message: None,
    };

    assert_eq!(
        format_ollama_status(&result),
        "connected: true\nbase url: http://localhost:11434/v1\nmemory: 32.0 GiB\nrecommended: ollama/gemma4:31b\nreason: Detected enough memory for Gemma 4 31B.\nversion: 0.12.0\ninstalled: gemma4:31b\nUse /model set ollama/gemma4:31b to select it.\nUse /ollama ensure gemma4:31b to prepare it."
    );
}

#[test]
fn run_focus_letters_control_navigation_without_blocking_prompt_typing() {
    let mut state = crate::state::AppState::new(
        initialized(),
        vec![run("r1", RunStatus::Queued), run("r2", RunStatus::Queued)],
    );

    state.apply(UiAction::ToggleFocus);
    handle_character_input(&mut state, 'j');
    assert_eq!(state.selected_run_id(), Some("r2"));
    handle_character_input(&mut state, 'k');
    assert_eq!(state.selected_run_id(), Some("r1"));
    handle_character_input(&mut state, 'q');
    assert!(state.should_quit);

    let mut prompt_state = crate::state::AppState::new(initialized(), Vec::new());
    assert_eq!(prompt_state.focus, FocusArea::Prompt);
    handle_character_input(&mut prompt_state, 'q');
    assert_eq!(prompt_state.prompt_input, "q");
    assert!(!prompt_state.should_quit);
}
