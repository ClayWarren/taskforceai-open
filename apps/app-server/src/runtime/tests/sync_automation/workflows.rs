use super::super::support::{
    json_response, result_value, start_recording_response_sequence_server, test_store_path,
    MockHttpResponse,
};
use super::super::*;
use taskforceai_app_protocol::{
    AttachmentRecord, WorkflowIDParams, WorkflowPhaseRunRecord, WorkflowRunRecord, WorkflowRunState,
};

fn workflow_record(
    workflow_id: &str,
    phases: Vec<WorkflowPhaseDefinition>,
) -> WorkflowDefinitionRecord {
    WorkflowDefinitionRecord {
        workflow_id: workflow_id.to_string(),
        name: "Coverage workflow".to_string(),
        description: None,
        version: "1.0.0".to_string(),
        visibility: WorkflowVisibility::Personal,
        args_schema: None,
        budget: None,
        phases,
        output_schema: None,
        tags: Vec::new(),
        created_at: 0,
        updated_at: 0,
    }
}

fn local_review_phase(phase_id: &str) -> WorkflowPhaseDefinition {
    WorkflowPhaseDefinition {
        phase_id: phase_id.to_string(),
        name: "Local review".to_string(),
        kind: WorkflowPhaseKind::Review,
        prompt: None,
        depends_on: Vec::new(),
        agent_count: None,
        output_schema: None,
    }
}

fn linked_phase(phase_id: &str, run_ids: Vec<&str>) -> WorkflowPhaseRunRecord {
    WorkflowPhaseRunRecord {
        phase_id: phase_id.to_string(),
        state: WorkflowRunState::Running,
        agent_run_ids: run_ids.into_iter().map(ToOwned::to_owned).collect(),
        result: None,
        error: None,
        started_at: Some(1),
        completed_at: None,
    }
}

fn workflow_run_record(
    run_id: &str,
    state: WorkflowRunState,
    phase_runs: Vec<WorkflowPhaseRunRecord>,
) -> WorkflowRunRecord {
    WorkflowRunRecord {
        run_id: run_id.to_string(),
        workflow_id: "state-update".to_string(),
        workflow_version: "1.0.0".to_string(),
        state,
        args: json!({}),
        phase_runs,
        agent_run_ids: Vec::new(),
        output: None,
        error: None,
        created_at: 1,
        updated_at: 1,
    }
}

fn app_run_record(
    id: &str,
    status: RunStatus,
    output: Option<&str>,
    error: Option<&str>,
) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        prompt: "workflow linked run".to_string(),
        model_id: None,
        project_id: None,
        status,
        output: output.map(ToOwned::to_owned),
        error: error.map(ToOwned::to_owned),
        created_at: 1,
        updated_at: 9,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

#[tokio::test]
async fn workflows_round_trip_through_local_metadata() {
    let store_path = test_store_path("workflows");
    let mut runtime = AppRuntime::new(RuntimeConfig::default().with_run_store_path(&store_path));

    let workflow = WorkflowDefinitionRecord {
        workflow_id: "codebase-audit".to_string(),
        name: "Codebase audit".to_string(),
        description: Some("Fan out path auditors and review findings.".to_string()),
        version: "1.0.0".to_string(),
        visibility: WorkflowVisibility::Project,
        args_schema: None,
        budget: Some(WorkflowBudget {
            max_cost_usd: Some(2.0),
            max_tokens: Some(200_000),
            max_seconds: Some(900),
            max_concurrency: Some(4),
        }),
        phases: vec![
            WorkflowPhaseDefinition {
                phase_id: "fanout".to_string(),
                name: "Path auditors".to_string(),
                kind: WorkflowPhaseKind::Fanout,
                prompt: Some("Audit assigned paths.".to_string()),
                depends_on: Vec::new(),
                agent_count: Some(4),
                output_schema: None,
            },
            WorkflowPhaseDefinition {
                phase_id: "review".to_string(),
                name: "Adversarial review".to_string(),
                kind: WorkflowPhaseKind::Review,
                prompt: None,
                depends_on: vec!["fanout".to_string()],
                agent_count: None,
                output_schema: None,
            },
        ],
        output_schema: None,
        tags: vec!["audit".to_string()],
        created_at: 0,
        updated_at: 0,
    };

    let saved = result_value(
        runtime
            .workflow_save(WorkflowSaveParams { workflow })
            .expect("workflow save should work"),
    );
    assert_eq!(saved["workflow"]["workflowId"], "codebase-audit");
    assert!(saved["workflow"]["createdAt"].as_u64().expect("created at") > 0);

    let listed = result_value(runtime.workflow_list().expect("workflow list should work"));
    assert_eq!(listed["workflows"].as_array().expect("workflows").len(), 1);

    let mut restarted = AppRuntime::new(RuntimeConfig::default().with_run_store_path(&store_path));
    let listed = result_value(
        restarted
            .workflow_list()
            .expect("workflow list should persist"),
    );
    assert_eq!(listed["workflows"][0]["name"], "Codebase audit");

    let run = result_value(
        restarted
            .workflow_run(WorkflowRunParams {
                workflow_id: "codebase-audit".to_string(),
                args: serde_json::json!({"paths": ["apps/app-server"]}),
            })
            .await
            .expect("workflow run should queue"),
    );
    let run_id = run["run"]["runId"].as_str().expect("run id").to_string();
    assert_eq!(run["run"]["state"], "running");
    assert_eq!(
        run["run"]["phaseRuns"]
            .as_array()
            .expect("phase runs")
            .len(),
        2
    );
    assert_eq!(
        run["run"]["phaseRuns"][0]["agentRunIds"]
            .as_array()
            .expect("agent run ids")
            .len(),
        4
    );

    let paused = result_value(
        restarted
            .workflow_run_pause(WorkflowRunIDParams {
                run_id: run_id.clone(),
            })
            .expect("workflow run pause should work"),
    );
    assert_eq!(paused["run"]["state"], "paused");

    let cancelled = result_value(
        restarted
            .workflow_run_cancel(WorkflowRunIDParams { run_id })
            .expect("workflow run cancel should work"),
    );
    assert_eq!(cancelled["run"]["state"], "cancelled");

    let _ = fs::remove_file(store_path);
}

#[tokio::test]
async fn schedule_methods_reject_invalid_inputs_and_skip_disabled_ticks() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let invalid = runtime
        .schedule_add(ScheduleAddParams {
            name: "daily".to_string(),
            cadence: "   ".to_string(),
            prompt: "summarize".to_string(),
            target_session_id: None,
            enabled: true,
        })
        .expect_err("blank cadence should fail");
    assert_eq!(invalid.code, -32602);

    let disabled = result_value(
        runtime
            .schedule_add(ScheduleAddParams {
                name: "paused".to_string(),
                cadence: "daily".to_string(),
                prompt: "summarize".to_string(),
                target_session_id: None,
                enabled: false,
            })
            .expect("disabled schedule should add"),
    );
    let schedule_id = disabled["schedule"]["scheduleId"]
        .as_str()
        .expect("schedule id")
        .to_string();
    let ticked = result_value(
        runtime
            .schedule_tick(ScheduleTickParams { now: Some(10) })
            .await
            .expect("disabled schedule tick should succeed"),
    );
    assert!(ticked["dispatched"]
        .as_array()
        .expect("dispatched should be array")
        .is_empty());

    let missing_delete = runtime
        .schedule_delete(ScheduleIDParams {
            schedule_id: "missing".to_string(),
        })
        .expect_err("missing schedule delete should fail");
    assert_eq!(missing_delete.code, -32004);
    runtime
        .schedule_delete(ScheduleIDParams { schedule_id })
        .expect("disabled schedule should delete");
}

#[tokio::test]
async fn workflow_run_ids_do_not_collide_in_same_millisecond() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let workflow = WorkflowDefinitionRecord {
        workflow_id: "no-collision".to_string(),
        name: "No collision".to_string(),
        description: None,
        version: "1.0.0".to_string(),
        visibility: WorkflowVisibility::Personal,
        args_schema: None,
        budget: None,
        phases: vec![WorkflowPhaseDefinition {
            phase_id: "review".to_string(),
            name: "Review".to_string(),
            kind: WorkflowPhaseKind::Review,
            prompt: None,
            depends_on: Vec::new(),
            agent_count: None,
            output_schema: None,
        }],
        output_schema: None,
        tags: Vec::new(),
        created_at: 0,
        updated_at: 0,
    };
    runtime
        .workflow_save(WorkflowSaveParams { workflow })
        .expect("workflow save should work");

    let first = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "no-collision".to_string(),
                args: json!({}),
            })
            .await
            .expect("first workflow run should queue"),
    );
    let second = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "no-collision".to_string(),
                args: json!({}),
            })
            .await
            .expect("second workflow run should queue"),
    );

    assert_ne!(first["run"]["runId"], second["run"]["runId"]);
}

#[test]
fn workflow_save_validates_phase_dependencies() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let err = runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "bad".to_string(),
                name: "Bad".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![WorkflowPhaseDefinition {
                    phase_id: "review".to_string(),
                    name: "Review".to_string(),
                    kind: WorkflowPhaseKind::Review,
                    prompt: None,
                    depends_on: vec!["missing".to_string()],
                    agent_count: None,
                    output_schema: None,
                }],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect_err("invalid workflow should fail");

    assert_eq!(err.code, -32602);
    assert!(err.message.contains("does not exist"));
}

#[tokio::test]
async fn workflow_methods_cover_update_delete_local_completion_and_missing_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let workflow = workflow_record("local-only", vec![local_review_phase("review")]);
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow.clone(),
        })
        .expect("workflow save should work");

    let mut renamed = workflow;
    renamed.name = "Renamed workflow".to_string();
    let updated = result_value(
        runtime
            .workflow_save(WorkflowSaveParams { workflow: renamed })
            .expect("existing workflow should update"),
    );
    assert_eq!(updated["workflow"]["name"], "Renamed workflow");

    let completed = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "local-only".to_string(),
                args: json!({"topic": "coverage"}),
            })
            .await
            .expect("local workflow run should complete"),
    );
    assert_eq!(completed["run"]["state"], "completed");
    assert_eq!(completed["run"]["output"]["phaseCount"], 1);
    assert_eq!(
        completed["run"]["phaseRuns"][0]["result"]["message"],
        "Completed locally without agent execution."
    );

    let run_id = completed["run"]["runId"]
        .as_str()
        .expect("run id")
        .to_string();
    let deleted = result_value(
        runtime
            .workflow_delete(WorkflowIDParams {
                workflow_id: "local-only".to_string(),
            })
            .expect("workflow delete should work"),
    );
    assert_eq!(deleted["ok"], true);

    let missing_workflow = runtime
        .workflow_get(WorkflowIDParams {
            workflow_id: "local-only".to_string(),
        })
        .expect_err("deleted workflow should not be found");
    assert_eq!(missing_workflow.code, -32004);
    let missing_delete = runtime
        .workflow_delete(WorkflowIDParams {
            workflow_id: "local-only".to_string(),
        })
        .expect_err("missing workflow delete should fail");
    assert_eq!(missing_delete.code, -32004);
    let missing_run = runtime
        .workflow_run_get(WorkflowRunIDParams {
            run_id: "missing-run".to_string(),
        })
        .expect_err("missing workflow run should fail");
    assert_eq!(missing_run.code, -32004);
    let missing_pause = runtime
        .workflow_run_pause(WorkflowRunIDParams {
            run_id: "missing-run".to_string(),
        })
        .expect_err("missing workflow run pause should fail");
    assert_eq!(missing_pause.code, -32004);
    let missing_replace = runtime
        .replace_workflow_run(WorkflowRunRecord {
            run_id: "missing-run".to_string(),
            workflow_id: "local-only".to_string(),
            workflow_version: "1.0.0".to_string(),
            state: WorkflowRunState::Queued,
            args: json!({}),
            phase_runs: Vec::new(),
            agent_run_ids: Vec::new(),
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
        })
        .expect_err("missing replace should fail");
    assert_eq!(missing_replace.code, -32004);

    let completed_run = runtime
        .workflow_run_get(WorkflowRunIDParams { run_id })
        .expect("completed run should remain readable");
    assert_eq!(result_value(completed_run)["run"]["state"], "completed");
}

#[tokio::test]
async fn advance_ready_workflow_runs_skips_terminal_and_missing_workflows() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow_record("existing", vec![local_review_phase("review")]),
        })
        .expect("workflow save should work");
    runtime
        .save_workflow_runs(&[
            WorkflowRunRecord {
                run_id: "terminal".to_string(),
                workflow_id: "existing".to_string(),
                workflow_version: "1.0.0".to_string(),
                state: WorkflowRunState::Paused,
                args: json!({}),
                phase_runs: vec![WorkflowPhaseRunRecord {
                    phase_id: "review".to_string(),
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
                updated_at: 1,
            },
            WorkflowRunRecord {
                run_id: "orphaned".to_string(),
                workflow_id: "missing".to_string(),
                workflow_version: "1.0.0".to_string(),
                state: WorkflowRunState::Queued,
                args: json!({}),
                phase_runs: Vec::new(),
                agent_run_ids: Vec::new(),
                output: None,
                error: None,
                created_at: 2,
                updated_at: 2,
            },
        ])
        .expect("workflow runs should save");

    let events = runtime
        .advance_ready_workflow_runs()
        .await
        .expect("advance should skip non-actionable runs");

    assert!(events.is_empty());
}

#[test]
fn workflow_run_state_updates_cover_failed_cancelled_running_and_missing_links() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime.runs.insert(
        "failed-run".to_string(),
        app_run_record(
            "failed-run",
            RunStatus::Failed,
            None,
            Some("phase exploded"),
        ),
    );
    runtime.runs.insert(
        "cancelled-run".to_string(),
        app_run_record("cancelled-run", RunStatus::Canceled, None, None),
    );
    runtime.runs.insert(
        "completed-run".to_string(),
        app_run_record(
            "completed-run",
            RunStatus::Completed,
            Some("phase output"),
            None,
        ),
    );
    runtime.runs.insert(
        "processing-run".to_string(),
        app_run_record("processing-run", RunStatus::Processing, None, None),
    );
    runtime
        .save_workflow_runs(&[
            workflow_run_record(
                "failed-workflow",
                WorkflowRunState::Running,
                vec![linked_phase("failed", vec!["failed-run"])],
            ),
            workflow_run_record(
                "cancelled-workflow",
                WorkflowRunState::Running,
                vec![linked_phase("cancelled", vec!["cancelled-run"])],
            ),
            workflow_run_record(
                "completed-workflow",
                WorkflowRunState::Running,
                vec![linked_phase("completed", vec!["completed-run"])],
            ),
            workflow_run_record(
                "still-running-workflow",
                WorkflowRunState::Running,
                vec![linked_phase("running", vec!["processing-run"])],
            ),
            workflow_run_record(
                "missing-linked-run",
                WorkflowRunState::Running,
                vec![linked_phase("missing", vec!["missing-run"])],
            ),
            workflow_run_record(
                "terminal-skip",
                WorkflowRunState::Failed,
                vec![linked_phase("terminal", vec!["completed-run"])],
            ),
        ])
        .expect("workflow runs should save");

    let failed_run = runtime
        .runs
        .get("failed-run")
        .expect("failed run should exist")
        .clone();
    let updated = runtime
        .update_workflow_runs_for_run(&failed_run)
        .expect("failed run should update workflow");
    assert_eq!(updated[0].state, WorkflowRunState::Failed);
    assert_eq!(updated[0].error.as_deref(), Some("phase exploded"));

    let cancelled_run = runtime
        .runs
        .get("cancelled-run")
        .expect("cancelled run should exist")
        .clone();
    let updated = runtime
        .update_workflow_runs_for_run(&cancelled_run)
        .expect("cancelled run should update workflow");
    assert_eq!(updated[0].state, WorkflowRunState::Cancelled);

    let completed_run = runtime
        .runs
        .get("completed-run")
        .expect("completed run should exist")
        .clone();
    let updated = runtime
        .update_workflow_runs_for_run(&completed_run)
        .expect("completed run should update workflow");
    assert_eq!(updated[0].state, WorkflowRunState::Completed);
    assert_eq!(
        updated[0].phase_runs[0].result.as_ref().expect("result")["outputs"][0],
        "phase output"
    );

    let processing_run = runtime
        .runs
        .get("processing-run")
        .expect("processing run should exist")
        .clone();
    let updated = runtime
        .update_workflow_runs_for_run(&processing_run)
        .expect("processing run should leave workflow running");
    assert!(updated.is_empty());

    let missing = app_run_record("missing-run", RunStatus::Completed, Some("late"), None);
    let updated = runtime
        .update_workflow_runs_for_run(&missing)
        .expect("missing linked run should be skipped");
    assert!(updated.is_empty());
}

#[test]
fn workflow_save_validates_required_fields_and_duplicate_phase_edges() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let base_phase = local_review_phase("review");

    for (label, workflow) in [
        (
            "workflow id",
            workflow_record("   ", vec![base_phase.clone()]),
        ),
        (
            "workflow name",
            WorkflowDefinitionRecord {
                name: "   ".to_string(),
                ..workflow_record("bad-name", vec![base_phase.clone()])
            },
        ),
        (
            "workflow version",
            WorkflowDefinitionRecord {
                version: "   ".to_string(),
                ..workflow_record("bad-version", vec![base_phase.clone()])
            },
        ),
        (
            "at least one phase",
            workflow_record("no-phases", Vec::new()),
        ),
        (
            "phase id",
            workflow_record("bad-phase-id", vec![local_review_phase("   ")]),
        ),
        (
            "phase name",
            workflow_record(
                "bad-phase-name",
                vec![WorkflowPhaseDefinition {
                    name: "   ".to_string(),
                    ..local_review_phase("review")
                }],
            ),
        ),
        (
            "phase ids must be unique",
            workflow_record(
                "duplicate-phase",
                vec![local_review_phase("same"), local_review_phase("same")],
            ),
        ),
        (
            "agent count must be greater than zero",
            workflow_record(
                "zero-agent-count",
                vec![WorkflowPhaseDefinition {
                    agent_count: Some(0),
                    ..local_review_phase("review")
                }],
            ),
        ),
        (
            "max concurrency must be greater than zero",
            WorkflowDefinitionRecord {
                budget: Some(WorkflowBudget {
                    max_cost_usd: None,
                    max_tokens: None,
                    max_seconds: None,
                    max_concurrency: Some(0),
                }),
                ..workflow_record("zero-concurrency", vec![base_phase.clone()])
            },
        ),
    ] {
        let err = runtime
            .workflow_save(WorkflowSaveParams { workflow })
            .expect_err(&format!("{label} should fail"));
        assert!(err.message.contains(label), "{label}: {}", err.message);
    }
}

#[test]
fn workflow_save_rejects_unbounded_fanout_budgets() {
    fn workflow_with(
        max_concurrency: Option<u16>,
        phases: Vec<WorkflowPhaseDefinition>,
    ) -> WorkflowDefinitionRecord {
        WorkflowDefinitionRecord {
            workflow_id: "fanout-budget".to_string(),
            name: "Fanout budget".to_string(),
            description: None,
            version: "1.0.0".to_string(),
            visibility: WorkflowVisibility::Personal,
            args_schema: None,
            budget: max_concurrency.map(|max_concurrency| WorkflowBudget {
                max_cost_usd: None,
                max_tokens: None,
                max_seconds: None,
                max_concurrency: Some(max_concurrency),
            }),
            phases,
            output_schema: None,
            tags: Vec::new(),
            created_at: 0,
            updated_at: 0,
        }
    }
    fn fanout_phase(index: usize, agent_count: u16) -> WorkflowPhaseDefinition {
        WorkflowPhaseDefinition {
            phase_id: format!("fanout-{index}"),
            name: format!("Fanout {index}"),
            kind: WorkflowPhaseKind::Fanout,
            prompt: Some("Do work.".to_string()),
            depends_on: Vec::new(),
            agent_count: Some(agent_count),
            output_schema: None,
        }
    }

    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let err = runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow_with(Some(17), vec![fanout_phase(0, 1)]),
        })
        .expect_err("oversized max concurrency should fail");
    assert!(err.message.contains("max concurrency cannot exceed"));

    let err = runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow_with(None, vec![fanout_phase(0, 17)]),
        })
        .expect_err("oversized phase agent count should fail");
    assert!(err.message.contains("phase agent count cannot exceed"));

    let err = runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow_with(None, (0..65).map(|index| fanout_phase(index, 1)).collect()),
        })
        .expect_err("oversized phase count should fail");
    assert!(err.message.contains("more than 64 phases"));

    let err = runtime
        .workflow_save(WorkflowSaveParams {
            workflow: workflow_with(None, (0..9).map(|index| fanout_phase(index, 16)).collect()),
        })
        .expect_err("oversized total dispatch count should fail");
    assert!(err.message.contains("more than 128 agent runs"));
}

#[tokio::test]
async fn workflow_command_lists_definitions_and_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "audit".to_string(),
                name: "Audit".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![WorkflowPhaseDefinition {
                    phase_id: "one".to_string(),
                    name: "One".to_string(),
                    kind: WorkflowPhaseKind::Prompt,
                    prompt: Some("Check this.".to_string()),
                    depends_on: Vec::new(),
                    agent_count: None,
                    output_schema: None,
                }],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");

    let listed = runtime
        .handle_workflow_command(&["list"])
        .await
        .expect("workflow list command should work");
    assert!(listed.message.contains("audit"));

    let run = runtime
        .handle_workflow_command(&["run", "audit"])
        .await
        .expect("workflow run command should work");
    assert!(run.message.contains("Queued workflow-run-"));

    let runs = runtime
        .handle_workflow_command(&["runs"])
        .await
        .expect("workflow runs command should work");
    assert!(runs.message.contains("workflow-run-"));
}

#[tokio::test]
async fn workflow_run_tracks_linked_app_server_run_completion() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "single".to_string(),
                name: "Single phase".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![WorkflowPhaseDefinition {
                    phase_id: "one".to_string(),
                    name: "One".to_string(),
                    kind: WorkflowPhaseKind::Prompt,
                    prompt: Some("Do one thing.".to_string()),
                    depends_on: Vec::new(),
                    agent_count: None,
                    output_schema: None,
                }],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");

    let run = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "single".to_string(),
                args: serde_json::Value::Null,
            })
            .await
            .expect("workflow run should start"),
    );
    let workflow_run_id = run["run"]["runId"].as_str().expect("workflow run id");
    let agent_run_id = run["run"]["phaseRuns"][0]["agentRunIds"][0]
        .as_str()
        .expect("agent run id")
        .to_string();

    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(RunRecord {
                id: agent_run_id,
                prompt: "Do one thing.".to_string(),
                model_id: None,
                project_id: None,
                status: RunStatus::Completed,
                output: Some("done".to_string()),
                error: None,
                created_at: 1,
                updated_at: 2,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            }),
        })
        .expect("run event should update workflow");

    let workflow_run = result_value(
        runtime
            .workflow_run_get(WorkflowRunIDParams {
                run_id: workflow_run_id.to_string(),
            })
            .expect("workflow run should be readable"),
    );
    assert_eq!(workflow_run["run"]["state"], "completed");
    assert_eq!(workflow_run["run"]["phaseRuns"][0]["state"], "completed");
    assert_eq!(
        workflow_run["run"]["phaseRuns"][0]["result"]["outputs"][0],
        "done"
    );
}

#[tokio::test]
async fn workflow_run_starts_dependent_phase_after_prerequisite_completes() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "dependent".to_string(),
                name: "Dependent phases".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![
                    WorkflowPhaseDefinition {
                        phase_id: "first".to_string(),
                        name: "First".to_string(),
                        kind: WorkflowPhaseKind::Prompt,
                        prompt: Some("Do the first thing.".to_string()),
                        depends_on: Vec::new(),
                        agent_count: None,
                        output_schema: None,
                    },
                    WorkflowPhaseDefinition {
                        phase_id: "second".to_string(),
                        name: "Second".to_string(),
                        kind: WorkflowPhaseKind::Prompt,
                        prompt: Some("Use the first result.".to_string()),
                        depends_on: vec!["first".to_string()],
                        agent_count: None,
                        output_schema: None,
                    },
                ],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");

    let run = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "dependent".to_string(),
                args: serde_json::Value::Null,
            })
            .await
            .expect("workflow run should start"),
    );
    let workflow_run_id = run["run"]["runId"].as_str().expect("workflow run id");
    let first_agent_run_id = run["run"]["phaseRuns"][0]["agentRunIds"][0]
        .as_str()
        .expect("first agent run id")
        .to_string();
    assert_eq!(run["run"]["phaseRuns"][0]["state"], "running");
    assert_eq!(run["run"]["phaseRuns"][1]["state"], "queued");

    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(RunRecord {
                id: first_agent_run_id,
                prompt: "Do the first thing.".to_string(),
                model_id: None,
                project_id: None,
                status: RunStatus::Completed,
                output: Some("first done".to_string()),
                error: None,
                created_at: 1,
                updated_at: 2,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            }),
        })
        .expect("first run completion should apply");
    let advance_events = runtime
        .advance_ready_workflow_runs()
        .await
        .expect("dependent phase should advance");
    assert!(
        advance_events
            .iter()
            .any(|event| matches!(event, AppServerEvent::WorkflowRunUpdated { .. })),
        "advance should emit workflow update"
    );

    let workflow_run = result_value(
        runtime
            .workflow_run_get(WorkflowRunIDParams {
                run_id: workflow_run_id.to_string(),
            })
            .expect("workflow run should be readable"),
    );
    assert_eq!(workflow_run["run"]["phaseRuns"][0]["state"], "completed");
    assert_eq!(workflow_run["run"]["phaseRuns"][1]["state"], "running");
    assert_eq!(
        workflow_run["run"]["phaseRuns"][1]["agentRunIds"]
            .as_array()
            .expect("second agent run ids")
            .len(),
        1
    );
}

#[tokio::test]
async fn workflow_run_drains_local_phases_after_prerequisite_completes() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "local-chain".to_string(),
                name: "Local phase chain".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![
                    WorkflowPhaseDefinition {
                        phase_id: "first".to_string(),
                        name: "First".to_string(),
                        kind: WorkflowPhaseKind::Prompt,
                        prompt: Some("Produce a first result.".to_string()),
                        depends_on: Vec::new(),
                        agent_count: None,
                        output_schema: None,
                    },
                    WorkflowPhaseDefinition {
                        phase_id: "reduce".to_string(),
                        name: "Reduce".to_string(),
                        kind: WorkflowPhaseKind::Reduce,
                        prompt: None,
                        depends_on: vec!["first".to_string()],
                        agent_count: None,
                        output_schema: None,
                    },
                    WorkflowPhaseDefinition {
                        phase_id: "artifact".to_string(),
                        name: "Artifact".to_string(),
                        kind: WorkflowPhaseKind::Artifact,
                        prompt: None,
                        depends_on: vec!["reduce".to_string()],
                        agent_count: None,
                        output_schema: None,
                    },
                ],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");

    let run = result_value(
        runtime
            .workflow_run(WorkflowRunParams {
                workflow_id: "local-chain".to_string(),
                args: serde_json::Value::Null,
            })
            .await
            .expect("workflow run should start"),
    );
    let workflow_run_id = run["run"]["runId"].as_str().expect("workflow run id");
    let first_agent_run_id = run["run"]["phaseRuns"][0]["agentRunIds"][0]
        .as_str()
        .expect("first agent run id")
        .to_string();

    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(RunRecord {
                id: first_agent_run_id,
                prompt: "Produce a first result.".to_string(),
                model_id: None,
                project_id: None,
                status: RunStatus::Completed,
                output: Some("first done".to_string()),
                error: None,
                created_at: 1,
                updated_at: 2,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            }),
        })
        .expect("first run completion should apply");

    let advance_events = runtime
        .advance_ready_workflow_runs()
        .await
        .expect("local phases should advance");
    assert!(
        advance_events
            .iter()
            .any(|event| matches!(event, AppServerEvent::WorkflowRunUpdated { .. })),
        "advance should emit workflow update"
    );

    let workflow_run = result_value(
        runtime
            .workflow_run_get(WorkflowRunIDParams {
                run_id: workflow_run_id.to_string(),
            })
            .expect("workflow run should be readable"),
    );
    assert_eq!(workflow_run["run"]["state"], "completed");
    assert_eq!(workflow_run["run"]["phaseRuns"][0]["state"], "completed");
    assert_eq!(workflow_run["run"]["phaseRuns"][1]["state"], "completed");
    assert_eq!(workflow_run["run"]["phaseRuns"][2]["state"], "completed");
    assert_eq!(
        workflow_run["run"]["phaseRuns"][2]["result"]["dependencies"][0]["phaseId"],
        "reduce"
    );
    assert_eq!(
        workflow_run["run"]["output"]["phaseCount"],
        serde_json::json!(3)
    );
}

#[tokio::test]
async fn schedule_tick_dispatches_due_schedule_to_target_session() {
    let store_path = test_store_path("schedule-tick");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Watch scheduled tasks".to_string(),
                title: None,
                source: None,
            })
            .expect("agent session create should work"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();

    let schedule = result_value(
        runtime
            .schedule_add(ScheduleAddParams {
                name: "hourly checkpoint".to_string(),
                prompt: "run the checkpoint".to_string(),
                cadence: "hourly".to_string(),
                target_session_id: Some(session_id.clone()),
                enabled: true,
            })
            .expect("schedule add should work"),
    );
    assert!(schedule["schedule"]["nextRunAt"].is_null());

    let ticked = result_value(
        runtime
            .schedule_tick(ScheduleTickParams { now: Some(10_000) })
            .await
            .expect("schedule tick should dispatch due schedule"),
    );
    assert_eq!(
        ticked["dispatched"]
            .as_array()
            .expect("dispatched schedules")
            .len(),
        1
    );
    assert_eq!(ticked["dispatched"][0]["session"]["sessionId"], session_id);
    assert_eq!(
        ticked["dispatched"][0]["run"]["prompt"],
        "run the checkpoint"
    );
    assert_eq!(ticked["nextDueAt"], 3_610_000);

    let listed = result_value(runtime.schedule_list().expect("schedule list should work"));
    assert_eq!(listed["schedules"][0]["nextRunAt"], 3_610_000);

    let second_tick = result_value(
        runtime
            .schedule_tick(ScheduleTickParams { now: Some(10_001) })
            .await
            .expect("schedule tick should skip future schedule"),
    );
    assert_eq!(
        second_tick["dispatched"]
            .as_array()
            .expect("dispatched schedules")
            .len(),
        0
    );

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn schedule_tick_does_not_inherit_staged_attachment_ids() {
    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        MockHttpResponse {
            body: serde_json::json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            serde_json::json!({ "task_id": "scheduled_task_1", "status": "processing" })
                .to_string(),
        ),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    runtime
        .metadata_set(MetadataSetParams {
            key: "auth_token".to_string(),
            value: "token".to_string(),
        })
        .expect("auth token should persist");
    runtime.active_attachments.push(AttachmentRecord {
        id: "att-staged".to_string(),
        name: "staged.txt".to_string(),
        path: "/tmp/staged.txt".to_string(),
        mime_type: "text/plain".to_string(),
        size: 6,
    });
    runtime
        .schedule_add(ScheduleAddParams {
            name: "daily digest".to_string(),
            prompt: "run scheduled digest".to_string(),
            cadence: "daily".to_string(),
            target_session_id: None,
            enabled: true,
        })
        .expect("schedule add should work");

    let ticked = result_value(
        runtime
            .schedule_tick(ScheduleTickParams { now: Some(10_000) })
            .await
            .expect("schedule tick should dispatch due schedule"),
    );

    assert_eq!(ticked["dispatched"][0]["run"]["id"], "scheduled_task_1");
    assert_eq!(runtime.active_attachments[0].id, "att-staged");
    server.join().expect("mock submit server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[1].path, "/run");
    let body: serde_json::Value =
        serde_json::from_str(&requests[1].body).expect("submit body should be json");
    assert_eq!(body["prompt"], "run scheduled digest");
    assert!(
        body.get("attachment_ids").is_none(),
        "scheduled submissions must not inherit staged attachment ids: {body}"
    );
}
