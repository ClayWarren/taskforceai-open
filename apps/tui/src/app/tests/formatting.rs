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
