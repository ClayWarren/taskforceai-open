use super::*;

#[tokio::test]
async fn command_execute_searches_local_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("find this prompt"))
        .await
        .expect("submit should succeed");

    let result = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/search find".to_string(),
            })
            .await
            .expect("search command should succeed"),
    );

    assert!(result["message"]
        .as_str()
        .expect("message should be string")
        .contains("find this prompt"));
}

#[tokio::test]
async fn run_search_returns_matching_local_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    runtime
        .run_submit(submit_run_params("structured search target"))
        .await
        .expect("submit should succeed");

    let result = result_value(runtime.run_search(RunSearchParams {
        query: "target".to_string(),
        limit: 10,
    }));

    assert_eq!(result["query"], "target");
    assert_eq!(result["runs"][0]["prompt"], "structured search target");

    let empty = result_value(runtime.run_search(RunSearchParams {
        query: "   ".to_string(),
        limit: 0,
    }));
    assert_eq!(empty["query"], "");
    assert!(empty["runs"]
        .as_array()
        .expect("runs should be array")
        .is_empty());
}

#[tokio::test]
async fn command_execute_toggles_direct_chat() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let enabled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct on".to_string(),
            })
            .await
            .expect("direct command should succeed"),
    );
    assert_eq!(enabled["handled"], true);
    let status_direct = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct status".to_string(),
            })
            .await
            .expect("direct status should succeed"),
    );
    assert_eq!(status_direct["message"], "Direct chat is on.");
    let disabled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct off".to_string(),
            })
            .await
            .expect("direct off should succeed"),
    );
    assert_eq!(disabled["message"], "Direct chat is off.");
    let toggled = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct".to_string(),
            })
            .await
            .expect("direct toggle should succeed"),
    );
    assert_eq!(toggled["message"], "Direct chat is on.");
    let usage = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/direct sideways".to_string(),
            })
            .await
            .expect("bad direct command should return usage"),
    );
    assert_eq!(usage["handled"], false);
    assert!(usage["message"]
        .as_str()
        .expect("direct usage message")
        .contains("Usage: /direct"));

    let status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/status".to_string(),
            })
            .await
            .expect("status command should succeed"),
    );
    assert!(status["message"]
        .as_str()
        .expect("message should be string")
        .contains("direct chat: on"));
}

#[tokio::test]
async fn command_execute_manages_durable_goal() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let empty = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal".to_string(),
            })
            .await
            .expect("goal command should succeed"),
    );
    assert!(empty["message"]
        .as_str()
        .expect("message should be string")
        .contains("No active goal"));

    let set = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal Complete Rust TUI parity".to_string(),
            })
            .await
            .expect("goal set should succeed"),
    );
    assert_eq!(set["handled"], true);
    assert!(set["message"]
        .as_str()
        .expect("message should be string")
        .contains("Complete Rust TUI parity"));

    let paused = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal pause".to_string(),
            })
            .await
            .expect("goal pause should succeed"),
    );
    assert!(paused["message"]
        .as_str()
        .expect("message should be string")
        .contains("paused"));

    let current = result_value(runtime.goal_get().expect("goal get should succeed"));
    assert_eq!(current["goal"]["status"], "paused");
    assert_eq!(current["goal"]["objective"], "Complete Rust TUI parity");

    let resumed = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal resume".to_string(),
            })
            .await
            .expect("goal resume should succeed"),
    );
    assert!(resumed["message"]
        .as_str()
        .expect("message should be string")
        .contains("resumed"));

    let cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/goal clear".to_string(),
            })
            .await
            .expect("goal clear should succeed"),
    );
    assert_eq!(cleared["message"], "Goal cleared.");
    let current = result_value(runtime.goal_get().expect("goal get should succeed"));
    assert_eq!(current["goal"], Value::Null);
}

#[tokio::test]
async fn command_execute_covers_local_automation_pet_mcp_and_workflow_flows() {
    async fn command(runtime: &mut AppRuntime, input: &str) -> Value {
        result_value(
            runtime
                .command_execute(CommandExecuteParams {
                    input: input.to_string(),
                })
                .await
                .unwrap_or_else(|err| panic!("{input} should succeed: {err}")),
        )
    }

    let store_path = test_store_path("command-flows");
    let mut runtime = AppRuntime::new(RuntimeConfig::default().with_run_store_path(&store_path));

    assert!(command(&mut runtime, "/agents").await["message"]
        .as_str()
        .expect("agents list message")
        .contains("No agent sessions"));
    assert!(
        command(&mut runtime, "/agents create Cover command branches").await["message"]
            .as_str()
            .expect("agents create message")
            .contains("Created")
    );
    let sessions = result_value(
        runtime
            .agent_session_list()
            .expect("agent session list should work"),
    );
    let session_id = sessions["sessions"][0]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();
    assert!(
        command(&mut runtime, &format!("/agents pause {session_id}")).await["message"]
            .as_str()
            .expect("agents pause message")
            .contains("Paused")
    );
    assert!(
        command(&mut runtime, &format!("/agents resume {session_id}")).await["message"]
            .as_str()
            .expect("agents resume message")
            .contains("Resumed")
    );
    assert!(command(
        &mut runtime,
        &format!("/agents message {session_id} keep going")
    )
    .await["message"]
        .as_str()
        .expect("agents message output")
        .contains("Steering queued"));
    assert!(
        command(&mut runtime, &format!("/agents fork {session_id}")).await["message"]
            .as_str()
            .expect("agents fork message")
            .contains("Forked")
    );
    assert!(
        command(&mut runtime, &format!("/agents cancel {session_id}")).await["message"]
            .as_str()
            .expect("agents cancel message")
            .contains("Cancelled")
    );
    assert!(command(&mut runtime, "/agents unknown").await["message"]
        .as_str()
        .expect("agents usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/channel").await["message"]
        .as_str()
        .expect("channel list")
        .contains("No channels"));
    assert!(
        command(&mut runtime, &format!("/channel add ops {session_id}")).await["message"]
            .as_str()
            .expect("channel add message")
            .contains("Added ops")
    );
    let channels = result_value(runtime.channel_list().expect("channel list should work"));
    let channel_id = channels["channels"][0]["channelId"]
        .as_str()
        .expect("channel id")
        .to_string();
    assert!(command(
        &mut runtime,
        &format!("/channel push {channel_id} new event")
    )
    .await["message"]
        .as_str()
        .expect("channel push message")
        .contains("Pushed event"));
    assert!(
        command(&mut runtime, &format!("/channel delete {channel_id}")).await["message"]
            .as_str()
            .expect("channel delete message")
            .contains("Deleted")
    );
    assert!(command(&mut runtime, "/channel nope").await["message"]
        .as_str()
        .expect("channel usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/schedule").await["message"]
        .as_str()
        .expect("schedule list")
        .contains("No schedules"));
    assert!(
        command(&mut runtime, "/schedule add daily daily summarize updates").await["message"]
            .as_str()
            .expect("schedule add")
            .contains("Added daily")
    );
    let schedules = result_value(runtime.schedule_list().expect("schedule list should work"));
    let schedule_id = schedules["schedules"][0]["scheduleId"]
        .as_str()
        .expect("schedule id")
        .to_string();
    assert!(
        command(&mut runtime, &format!("/schedule disable {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule disable")
            .contains("Disabled")
    );
    assert!(
        command(&mut runtime, &format!("/schedule enable {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule enable")
            .contains("Enabled")
    );
    assert!(
        command(&mut runtime, &format!("/schedule delete {schedule_id}")).await["message"]
            .as_str()
            .expect("schedule delete")
            .contains("Deleted")
    );
    assert!(command(&mut runtime, "/schedule nope").await["message"]
        .as_str()
        .expect("schedule usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/pet").await["message"]
        .as_str()
        .expect("pet status")
        .contains("Pulse"));
    assert!(command(&mut runtime, "/pet hide").await["message"]
        .as_str()
        .expect("pet hide")
        .contains("hidden"));
    assert!(command(&mut runtime, "/pet show").await["message"]
        .as_str()
        .expect("pet show")
        .contains("visible"));
    assert!(command(&mut runtime, "/pet name Sentinel").await["message"]
        .as_str()
        .expect("pet name")
        .contains("Sentinel"));
    assert!(
        command(&mut runtime, "/pet mood celebrate").await["message"]
            .as_str()
            .expect("pet mood")
            .contains("celebrate")
    );
    assert!(command(&mut runtime, "/pet sleep").await["message"]
        .as_str()
        .expect("pet usage")
        .contains("Usage"));

    assert!(command(&mut runtime, "/mcp list").await["message"]
        .as_str()
        .expect("mcp list")
        .contains("No MCP servers"));
    assert!(command(
        &mut runtime,
        "/mcp add files https://example.com/mcp tools=read,write enabled=false"
    )
    .await["message"]
        .as_str()
        .expect("mcp add")
        .contains("Configured"));
    assert!(
        command(&mut runtime, "/mcp tools files search,list").await["message"]
            .as_str()
            .expect("mcp tools")
            .contains("Updated tools")
    );
    assert!(command(&mut runtime, "/mcp disable files").await["message"]
        .as_str()
        .expect("mcp disable")
        .contains("Disabled"));
    assert!(command(&mut runtime, "/mcp enable files").await["message"]
        .as_str()
        .expect("mcp enable")
        .contains("Enabled"));
    assert!(command(&mut runtime, "/mcp available").await["message"]
        .as_str()
        .expect("mcp available")
        .contains("Enabled MCP servers"));
    assert!(command(&mut runtime, "/mcp inspect files").await["message"]
        .as_str()
        .expect("mcp inspect")
        .contains("transport"));
    assert!(command(&mut runtime, "/mcp remove files").await["message"]
        .as_str()
        .expect("mcp remove")
        .contains("Removed"));
    assert_eq!(command(&mut runtime, "/mcp nope").await["handled"], false);

    runtime
        .workflow_save(WorkflowSaveParams {
            workflow: WorkflowDefinitionRecord {
                workflow_id: "slash-workflow".to_string(),
                name: "Slash Workflow".to_string(),
                description: None,
                version: "1.0.0".to_string(),
                visibility: WorkflowVisibility::Personal,
                args_schema: None,
                budget: None,
                phases: vec![WorkflowPhaseDefinition {
                    phase_id: "draft".to_string(),
                    name: "Draft".to_string(),
                    kind: WorkflowPhaseKind::Prompt,
                    prompt: Some("draft".to_string()),
                    depends_on: Vec::new(),
                    agent_count: Some(1),
                    output_schema: None,
                }],
                output_schema: None,
                tags: Vec::new(),
                created_at: 0,
                updated_at: 0,
            },
        })
        .expect("workflow save should work");
    assert!(command(&mut runtime, "/workflows list").await["message"]
        .as_str()
        .expect("workflow list")
        .contains("Slash Workflow"));
    assert!(
        command(&mut runtime, "/workflows run slash-workflow").await["message"]
            .as_str()
            .expect("workflow run")
            .contains("Queued")
    );
    let workflow_runs = result_value(
        runtime
            .workflow_run_list()
            .expect("workflow run list should work"),
    );
    let workflow_run_id = workflow_runs["runs"][0]["runId"]
        .as_str()
        .expect("workflow run id")
        .to_string();
    assert!(command(&mut runtime, "/workflows runs").await["message"]
        .as_str()
        .expect("workflow runs")
        .contains(&workflow_run_id));
    assert!(
        command(&mut runtime, &format!("/workflows pause {workflow_run_id}")).await["message"]
            .as_str()
            .expect("workflow pause")
            .contains("Paused")
    );
    assert!(command(
        &mut runtime,
        &format!("/workflows resume {workflow_run_id}")
    )
    .await["message"]
        .as_str()
        .expect("workflow resume")
        .contains("Resumed"));
    assert!(command(
        &mut runtime,
        &format!("/workflows cancel {workflow_run_id}")
    )
    .await["message"]
        .as_str()
        .expect("workflow cancel")
        .contains("Cancelled"));
    assert!(command(&mut runtime, "/workflows nope").await["message"]
        .as_str()
        .expect("workflow usage")
        .contains("Usage"));

    let _ = std::fs::remove_file(store_path);
}
