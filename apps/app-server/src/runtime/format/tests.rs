use serde_json::json;

use crate::api::ApiArtifactVersion;

use super::*;

fn run(id: &str, status: RunStatus) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        prompt: "Write a launch brief".to_string(),
        model_id: Some("sentinel".to_string()),
        project_id: Some(7),
        status,
        output: Some("Finished launch notes".to_string()),
        error: Some("No risk found".to_string()),
        created_at: 1,
        updated_at: 2,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

fn artifact(id: &str, current_version: Option<ApiArtifactVersion>) -> ApiArtifact {
    ApiArtifact {
        id: id.to_string(),
        title: "Launch plan".to_string(),
        artifact_type: "document".to_string(),
        status: "ready".to_string(),
        visibility: "private".to_string(),
        current_version_id: Some("v1".to_string()),
        created_at: Some("2026-01-01".to_string()),
        updated_at: Some("2026-01-02".to_string()),
        current_version,
    }
}

#[test]
fn core_status_and_search_formatters_cover_empty_and_populated_paths() {
    assert!(command_help_message().contains("/settings"));

    let free_usage = format_account_usage(
        &json!({
            "user": {
                "plan": "free",
                "messageCount": 2,
                "currentPeriodEnd": "tomorrow"
            }
        }),
        Some(&json!({ "credit_balance": 12.345 })),
    );
    assert!(free_usage.contains("plan: free"));
    assert!(free_usage.contains("2 used"));
    assert!(free_usage.contains("credits: $12.35"));
    assert!(free_usage.contains("resets tomorrow"));

    let super_usage = format_account_usage(
        &json!({ "plan": "super", "message_count": 4 }),
        Some(&json!({ "currentPeriodEnd": 123 })),
    );
    assert!(super_usage.contains("20 per hour"));
    assert!(super_usage.contains("resets 123"));

    assert_eq!(
        format_artifacts(&[]),
        "No artifacts yet. Generated files will appear here after completed runs."
    );
    let artifact_output = format_artifacts(&[
        artifact(
            "art-1",
            Some(ApiArtifactVersion {
                id: "version-1".to_string(),
                artifact_id: Some("art-1".to_string()),
                version: Some(1),
                file_id: Some("file-1".to_string()),
                filename: Some("launch.md".to_string()),
                mime_type: Some("text/markdown".to_string()),
                size_bytes: Some(1536),
                created_at: Some("2026-01-02".to_string()),
            }),
        ),
        artifact("art-2", None),
    ]);
    assert!(artifact_output.contains("Recent artifacts: 2 shown"));
    assert!(artifact_output.contains("launch.md"));
    assert!(artifact_output.contains("1.5 KB"));
    assert!(artifact_output.contains("no current version"));

    let usage = format_usage_summary(&UsageSummaryResult {
        total_runs: 4,
        completed_runs: 2,
        canceled_runs: 1,
        failed_runs: 1,
        queued_runs: 0,
        processing_runs: 0,
    });
    assert!(usage.contains("completed: 2"));

    let pet = default_pet_state();
    let status = format_status_summary(&StatusSummaryResult {
        transport: "http".to_string(),
        authenticated: true,
        run_count: 3,
        model_id: "sentinel".to_string(),
        quick_mode: true,
        autonomous: false,
        computer_use: true,
        pet: pet.clone(),
    });
    assert!(status.contains("direct chat: on"));
    assert!(status.contains("companion: Pulse"));

    assert!(normalize_pet_name("").is_err());
    assert!(normalize_pet_name("x".repeat(25).as_str()).is_err());
    assert_eq!(normalize_pet_name(" Sentinel ").unwrap(), "Sentinel");
    assert!(normalize_pet_mood("sleepy").is_err());
    assert_eq!(normalize_pet_mood(" Alert ").unwrap(), "alert");
    assert!(pet_message(&PetState {
        mood: "celebrate".to_string(),
        ..pet.clone()
    })
    .contains("celebrating"));
    assert!(pet_message(&PetState {
        mood: "alert".to_string(),
        ..pet.clone()
    })
    .contains("watching"));
    assert!(pet_message(&PetState {
        mood: "idle".to_string(),
        ..pet.clone()
    })
    .contains("standing by"));

    assert_eq!(search_message([].iter(), ""), "Usage: /search <query>");
    let records = [run("run-1", RunStatus::Completed)];
    assert!(search_message(records.iter(), "launch").contains("run-1"));
    assert!(search_message(records.iter(), "finished").contains("run-1"));
    assert!(search_message(records.iter(), "risk").contains("run-1"));
    assert!(search_message(records.iter(), "missing").contains("No local runs"));
    assert!(run_matches_query(&records[0], "launch"));
}

#[test]
fn automation_discovery_and_plugin_formatters_cover_empty_and_populated_paths() {
    assert!(format_goal_state(None).contains("No active goal"));
    assert!(format_goal_state(Some(GoalRecord {
        objective: "Reach coverage".to_string(),
        status: GoalStatus::Active,
        created_at: 1,
        updated_at: 2,
    }))
    .contains("Reach coverage"));

    assert!(format_agent_sessions(Vec::new()).contains("No agent sessions"));
    let session = AgentSessionRecord {
        session_id: "agent-1".to_string(),
        title: "Reviewer".to_string(),
        objective: "Review code".to_string(),
        state: "running".to_string(),
        source: "local".to_string(),
        task_mode: Default::default(),
        parent_session_id: None,
        last_message: Some("tighten tests".to_string()),
        run_ids: vec!["run-a".to_string(), "run-b".to_string()],
        active_run_id: Some("run-b".to_string()),
        last_error: None,
        created_at: 1,
        updated_at: 2,
    };
    assert!(format_agent_sessions(vec![session.clone()]).contains("active run: run-b"));
    let idle_session = AgentSessionRecord {
        active_run_id: None,
        last_message: None,
        ..session
    };
    assert!(format_agent_sessions(vec![idle_session]).contains("runs: 2"));

    assert!(format_channels(Vec::new()).contains("No channels"));
    assert!(format_channels(vec![ChannelRecord {
        channel_id: "chan-1".to_string(),
        name: "ops".to_string(),
        kind: "local".to_string(),
        enabled: false,
        target_session_id: Some("agent-1".to_string()),
        last_message: Some("ship it".to_string()),
        created_at: 1,
        updated_at: 2,
    }])
    .contains("last: ship it"));

    assert!(format_schedules(Vec::new()).contains("No schedules"));
    assert!(format_schedules(vec![ScheduleRecord {
        schedule_id: "sched-1".to_string(),
        name: "daily".to_string(),
        prompt: "summarize".to_string(),
        cadence: "daily".to_string(),
        enabled: true,
        target_session_id: None,
        next_run_at: Some(10),
        created_at: 1,
        updated_at: 2,
    }])
    .contains("every daily"));

    assert!(format_workflows(Vec::new()).contains("No workflows"));
    let workflow = WorkflowDefinitionRecord {
        workflow_id: "wf-1".to_string(),
        name: "Coverage".to_string(),
        description: None,
        version: "1".to_string(),
        visibility: WorkflowVisibility::Organization,
        args_schema: None,
        budget: None,
        phases: vec![WorkflowPhaseDefinition {
            phase_id: "phase-1".to_string(),
            name: "Test".to_string(),
            kind: WorkflowPhaseKind::Prompt,
            prompt: Some("cover".to_string()),
            depends_on: Vec::new(),
            agent_count: Some(1),
            output_schema: None,
        }],
        output_schema: None,
        tags: Vec::new(),
        created_at: 1,
        updated_at: 2,
    };
    assert!(format_workflows(vec![workflow]).contains("organization"));
    assert!(format_workflow_runs(Vec::new()).contains("No workflow runs"));
    assert!(format_workflow_runs(vec![WorkflowRunRecord {
        run_id: "wr-1".to_string(),
        workflow_id: "wf-1".to_string(),
        workflow_version: "1".to_string(),
        state: WorkflowRunState::Running,
        args: json!({}),
        phase_runs: vec![WorkflowPhaseRunRecord {
            phase_id: "phase-1".to_string(),
            state: WorkflowRunState::Queued,
            agent_run_ids: Vec::new(),
            result: None,
            error: None,
            started_at: None,
            completed_at: None,
        }],
        agent_run_ids: Vec::new(),
        output: None,
        error: None,
        created_at: 1,
        updated_at: 2,
    }])
    .contains("phases=1"));

    assert_eq!(
        format_diagnostics(DiagnosticsInspectResult {
            sections: Vec::new(),
            suggestions: Vec::new(),
        }),
        ""
    );
    let diagnostics = format_diagnostics(DiagnosticsInspectResult {
        sections: vec![DiagnosticSection {
            title: "Runtime".to_string(),
            items: vec![DiagnosticItem {
                label: "status".to_string(),
                value: "ok".to_string(),
            }],
        }],
        suggestions: vec!["add tests".to_string()],
    });
    assert!(diagnostics.contains("Runtime"));
    assert!(diagnostics.contains("Suggestions"));

    assert!(format_skills(Vec::new()).contains("No skills"));
    assert!(format_skills(vec![SkillRecord {
        name: "rust".to_string(),
        description: "Rust skill".to_string(),
        path: "/tmp/skill".to_string(),
        source: "local".to_string(),
        enabled: true,
    }])
    .contains("Rust skill"));
    assert!(format_plugins(Vec::new()).contains("No plugins"));
    let plugins = format_plugins(vec![
        PluginRecord {
            id: "browser".to_string(),
            name: "Browser".to_string(),
            path: "/tmp/browser".to_string(),
            enabled: true,
            description: Some("Open and inspect pages".to_string()),
            source: Some("local".to_string()),
        },
        PluginRecord {
            id: "disabled".to_string(),
            name: "Disabled".to_string(),
            path: "/tmp/disabled".to_string(),
            enabled: false,
            description: None,
            source: None,
        },
    ]);
    assert!(plugins.contains("[enabled]"));
    assert!(plugins.contains("[disabled]"));
    assert!(plugins.contains("Open and inspect pages"));
    assert!(plugins.contains("/plugins install"));
}

#[test]
fn integration_queue_and_context_formatters_cover_optional_paths() {
    assert!(computer_use_message(false, false).contains("not supported"));
    assert!(computer_use_message(true, true).contains("plugin detected"));
    assert!(computer_use_message(true, false).contains("no installed"));
    assert!(browser_message(true).contains("Browser plugin detected"));
    assert!(browser_message(false).contains("no installed Browser plugin"));

    assert_eq!(format_pending_prompts([].iter()), "No pending prompts.");
    let pending = [PendingPromptRecord {
        id: "prompt-1".to_string(),
        prompt: "finish".to_string(),
        model_id: None,
        reasoning_effort: None,
        project_id: None,
        status: PendingPromptStatus::Queued,
        retry_count: 0,
        last_error: None,
        created_at: 1,
        updated_at: 2,
    }];
    assert!(format_pending_prompts(pending.iter()).contains("prompt-1"));

    assert!(format_sync_status(&SyncStatusResult {
        device_id: None,
        last_sync_version: 0,
        configured: false,
    })
    .contains("not set"));

    assert!(format_mcp_servers(&[]).contains("No MCP servers"));
    let server = McpServerRecord {
        name: "files".to_string(),
        endpoint: "stdio:files".to_string(),
        tools: Vec::new(),
        enabled: true,
    };
    assert!(format_mcp_servers(std::slice::from_ref(&server)).contains("all tools"));
    let server_with_tools = McpServerRecord {
        tools: vec!["read".to_string(), "write".to_string()],
        enabled: false,
        ..server.clone()
    };
    assert!(format_mcp_servers(std::slice::from_ref(&server_with_tools)).contains("read,write"));

    assert!(format_prompt_queue(&[]).contains("No queued"));
    assert!(format_prompt_queue(&[PromptQueueRecord {
        id: None,
        conversation_id: "conv-1".to_string(),
        prompt: "continue".to_string(),
        status: "queued".to_string(),
        dispatch_timing: "after_response".to_string(),
        created_at: 1,
        updated_at: 2,
        model_id: Some("sentinel".to_string()),
        reasoning_effort: None,
        attachment_ids: vec!["att-1".to_string()],
    }])
    .contains("attachments=1"));

    assert!(format_pending_changes(&[]).contains("No pending"));
    assert!(format_pending_changes(&[PendingChangeRecord {
        id: None,
        change_type: "message".to_string(),
        entity_id: "msg-1".to_string(),
        operation: "upsert".to_string(),
        data: json!({}),
        created_at: 1,
    }])
    .contains("unpersisted"));

    assert!(format_mcp_available(&McpAvailableResult {
        servers: Vec::new(),
        adapter_ready: false,
        message: "MCP unavailable".to_string(),
    })
    .contains("No enabled"));
    assert!(format_mcp_available(&McpAvailableResult {
        servers: vec![server_with_tools.clone()],
        adapter_ready: true,
        message: "MCP ready".to_string(),
    })
    .contains("Enabled MCP servers"));
    assert!(format_mcp_inspect(&McpInspectResult {
        server: server_with_tools,
        transport: "stdio".to_string(),
        command: Some("bunx".to_string()),
        args: vec!["server".to_string()],
        adapter_ready: true,
        status: "connected".to_string(),
        auth_required: false,
        oauth_supported: false,
        message: "ready".to_string(),
    })
    .contains("args: server"));
    assert!(format_mcp_call_result(&McpToolCallResult {
        server_name: "files".to_string(),
        tool_name: "read".to_string(),
        adapter_ready: true,
        result: Some(json!({ "ok": true })),
        message: "called".to_string(),
    })
    .contains("files/read"));

    let orchestration = OrchestrationConfig {
        roles: vec![
            OrchestrationRole {
                name: "reviewer".to_string(),
                description: "reviews".to_string(),
                model_id: Some("sentinel".to_string()),
            },
            OrchestrationRole {
                name: "writer".to_string(),
                description: "writes".to_string(),
                model_id: None,
            },
        ],
        budget: Some(12.0),
    };
    assert!(format_orchestration_config(&orchestration).contains("reviewer"));
    assert_eq!(format_orchestration_budget(None), "Budget: Unlimited");
    assert_eq!(format_orchestration_budget(Some(1.5)), "Budget: $1.50");

    let context = format_context_summary(ContextSummaryResult {
        max_tokens: 100,
        estimated_tokens: 20,
        items: vec![ContextItem {
            category: "code".to_string(),
            label: "format.rs".to_string(),
            estimated_tokens: 12,
        }],
        suggestions: vec!["trim".to_string()],
    });
    assert!(context.contains("Suggestions:"));

    let memory = format_memory_summary(MemorySummaryResult {
        sources: vec![
            MemorySourceRecord {
                scope: "repo".to_string(),
                path: "/tmp/memory".to_string(),
                exists: true,
                bytes: 10,
                estimated_tokens: 2,
            },
            MemorySourceRecord {
                scope: "missing".to_string(),
                path: "/tmp/missing".to_string(),
                exists: false,
                bytes: 0,
                estimated_tokens: 0,
            },
        ],
        estimated_tokens: 2,
        suggestions: vec!["refresh".to_string()],
    });
    assert!(memory.contains("[found]"));
    assert!(memory.contains("[missing]"));
    assert!(memory.contains("Suggestions:"));
}
