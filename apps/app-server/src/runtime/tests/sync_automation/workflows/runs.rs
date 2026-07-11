use super::super::super::support::{
    json_response, result_value, start_recording_response_sequence_server, test_store_path,
    MockHttpResponse,
};
use super::super::super::*;
use taskforceai_app_protocol::{
    AttachmentRecord, RunRecord, RunStatus, WorkflowDefinitionRecord, WorkflowPhaseDefinition,
    WorkflowPhaseKind, WorkflowVisibility,
};

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
