use super::*;

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
        handle_local_command(&mut client, &mut state, "/code /tmp/workspace", &mut tasks)
            .await
            .expect("explicit code workspace should be rejected without RPC")
    );
    assert_eq!(
        state.command_output.as_deref(),
        Some("Code\nCode mode uses the directory where TaskForceAI was opened. Usage: /code")
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
    let workspace_path = crate::local_coding::default_workspace()
        .canonicalize()
        .expect("current workspace path");
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

    handle_local_command(&mut client, &mut state, "/code", &mut tasks)
        .await
        .expect("code mode should enable current-directory tools");
    assert!(state
        .command_output
        .as_deref()
        .expect("code output")
        .contains("Workspace Code mode enabled for"));
    assert_eq!(state.task_mode.label(), "code");

    server
        .join()
        .expect("model/code rpc sequence should finish");
}

#[tokio::test]
async fn chat_and_work_commands_switch_modes_without_changing_the_default() {
    let workspace_path = crate::local_coding::default_workspace()
        .canonicalize()
        .expect("current workspace path");
    let endpoint = format!(
        "stdio:bunx @modelcontextprotocol/server-filesystem \"{}\"",
        workspace_path
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    );
    let (base_url, server) = start_rpc_sequence_server(vec![
        ("mcp.remove", json!({"ok": true})),
        ("quickMode.set", json!({"enabled": false})),
        ("autonomousMode.set", json!({"enabled": false})),
        ("mcp.remove", json!({"ok": true})),
        ("quickMode.set", json!({"enabled": true})),
        ("autonomousMode.set", json!({"enabled": false})),
        ("mcp.add", mcp_server_result(&endpoint)),
        ("mcp.tools", mcp_server_result(&endpoint)),
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
