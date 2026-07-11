use super::super::support::{result_value, test_store_path};
use super::super::*;
use taskforceai_app_protocol::{ThreadStartParams, TurnInterruptParams};

#[test]
fn agent_sessions_round_trip_through_local_metadata() {
    let store_path = test_store_path("agent-sessions");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Migrate a client surface".to_string(),
                title: Some("Migration".to_string()),
                source: Some("tui".to_string()),
            })
            .expect("agent session create should work"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();
    assert_eq!(created["session"]["state"], "running");

    let messaged = result_value(
        runtime
            .agent_session_message(AgentSessionMessageParams {
                session_id: session_id.clone(),
                message: "Keep the public contract stable.".to_string(),
            })
            .expect("agent session message should work"),
    );
    assert_eq!(
        messaged["session"]["lastMessage"],
        "Keep the public contract stable."
    );

    let paused = result_value(
        runtime
            .agent_session_pause(AgentSessionIDParams {
                session_id: session_id.clone(),
            })
            .expect("agent session pause should work"),
    );
    assert_eq!(paused["session"]["state"], "paused");

    let forked = result_value(
        runtime
            .agent_session_fork(AgentSessionIDParams { session_id })
            .expect("agent session fork should work"),
    );
    assert!(forked["session"]["parentSessionId"]
        .as_str()
        .expect("parent session id")
        .starts_with("agent-"));
    assert_eq!(forked["session"]["state"], "running");

    let listed = result_value(
        runtime
            .agent_session_list()
            .expect("agent session list should work"),
    );
    assert_eq!(listed["sessions"].as_array().expect("sessions").len(), 2);

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn agent_and_thread_methods_reject_invalid_inputs_and_report_authenticated_diagnostics() {
    let mut runtime = AppRuntime::new(RuntimeConfig {
        auth_token_storage: AuthTokenStorage::Memory,
        ..RuntimeConfig::default()
    });

    assert_eq!(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "   ".to_string(),
                title: None,
                source: None,
            })
            .expect_err("blank session objective should fail")
            .message,
        "objective is required"
    );

    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Coordinate coverage".to_string(),
                title: Some("   ".to_string()),
                source: Some("   ".to_string()),
            })
            .expect("agent session create should use defaults"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();
    assert_eq!(created["session"]["title"], "Agent session");
    assert_eq!(created["session"]["source"], "manual");

    assert_eq!(
        runtime
            .agent_session_message(AgentSessionMessageParams {
                session_id: session_id.clone(),
                message: "   ".to_string(),
            })
            .expect_err("blank session message should fail")
            .message,
        "message is required"
    );

    assert_eq!(
        runtime
            .thread_start(ThreadStartParams {
                objective: "   ".to_string(),
                thread_id: None,
                title: None,
                source: None,
            })
            .expect_err("blank thread objective should fail")
            .message,
        "objective is required"
    );

    result_value(
        runtime
            .thread_start(ThreadStartParams {
                objective: "Thread coverage".to_string(),
                thread_id: Some("thread-coverage".to_string()),
                title: Some("   ".to_string()),
                source: Some("   ".to_string()),
            })
            .expect("thread should start"),
    );
    assert_eq!(
        runtime
            .thread_start(ThreadStartParams {
                objective: "Duplicate".to_string(),
                thread_id: Some("thread-coverage".to_string()),
                title: None,
                source: None,
            })
            .expect_err("duplicate thread id should fail")
            .message,
        "thread id already exists"
    );
    assert_eq!(
        runtime
            .turn_interrupt(TurnInterruptParams {
                thread_id: "thread-coverage".to_string(),
            })
            .expect_err("thread without active turn should fail")
            .message,
        "thread has no active turn"
    );

    runtime
        .set_auth_token(Some("token"))
        .expect("auth token should set");
    let diagnostics = result_value(
        runtime
            .diagnostics_inspect()
            .expect("diagnostics should work"),
    );
    let account = diagnostics["sections"]
        .as_array()
        .expect("sections")
        .iter()
        .find(|section| section["title"] == "Account")
        .expect("account section");
    assert_eq!(account["items"][0]["value"], "true");
}

#[tokio::test]
async fn agent_session_run_submits_and_tracks_owned_run() {
    let store_path = test_store_path("agent-session-run");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Keep improving parity".to_string(),
                title: None,
                source: Some("test".to_string()),
            })
            .expect("agent session create should work"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();

    result_value(
        runtime
            .agent_session_message(AgentSessionMessageParams {
                session_id: session_id.clone(),
                message: "Focus on executable sessions.".to_string(),
            })
            .expect("agent session message should work"),
    );

    let started = result_value(
        runtime
            .agent_session_run(AgentSessionRunParams {
                session_id: session_id.clone(),
                prompt: None,
                model_id: None,
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: None,
                attachment_ids: Vec::new(),
                client_mcp_tools: Vec::new(),
            })
            .await
            .expect("agent session run should submit a run"),
    );
    let run_id = started["run"]["id"].as_str().expect("run id").to_string();
    assert_eq!(started["session"]["activeRunId"], run_id);
    assert_eq!(started["session"]["runIds"][0], run_id);
    assert!(started["run"]["prompt"]
        .as_str()
        .expect("prompt")
        .contains("Steering: Focus on executable sessions."));

    let mut processing = runtime
        .get_run(&run_id)
        .expect("tracked run should be available");
    processing.status = RunStatus::Processing;
    processing.updated_at = unix_millis();
    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(processing),
        })
        .expect("processing event should apply");
    let session = result_value(
        runtime
            .agent_session_get(AgentSessionIDParams {
                session_id: session_id.clone(),
            })
            .expect("agent session should still exist"),
    );
    assert_eq!(session["session"]["state"], "running");
    assert_eq!(session["session"]["activeRunId"], run_id);

    runtime
        .update_agent_session_for_run(&RunRecord {
            id: "unowned-run".to_string(),
            prompt: "not owned".to_string(),
            model_id: None,
            project_id: None,
            status: RunStatus::Completed,
            output: None,
            error: None,
            created_at: 1,
            updated_at: 1,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        })
        .expect("unowned run update should be ignored");

    let mut completed = runtime
        .get_run(&run_id)
        .expect("tracked run should be available");
    completed.status = RunStatus::Completed;
    completed.output = Some("done".to_string());
    completed.updated_at = unix_millis();
    runtime
        .apply_event(AppServerEvent::RunUpdated {
            run: Box::new(completed),
        })
        .expect("completion event should apply");

    let session = result_value(
        runtime
            .agent_session_get(AgentSessionIDParams { session_id })
            .expect("agent session should still exist"),
    );
    assert_eq!(session["session"]["state"], "completed");
    assert!(session["session"]["activeRunId"].is_null());

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn diagnostics_include_automation_inventory() {
    let store_path = test_store_path("diagnostics");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Track background work".to_string(),
                title: None,
                source: None,
            })
            .expect("agent session create should work"),
    );
    result_value(
        runtime
            .channel_add(ChannelAddParams {
                name: "local".to_string(),
                kind: "local".to_string(),
                target_session_id: None,
                enabled: true,
            })
            .expect("channel add should work"),
    );
    result_value(
        runtime
            .schedule_add(ScheduleAddParams {
                name: "morning check".to_string(),
                prompt: "summarize overnight work".to_string(),
                cadence: "daily".to_string(),
                target_session_id: None,
                enabled: true,
            })
            .expect("schedule add should work"),
    );

    let diagnostics = result_value(
        runtime
            .diagnostics_inspect()
            .expect("diagnostics should work"),
    );
    let automation = diagnostics["sections"]
        .as_array()
        .expect("sections")
        .iter()
        .find(|section| section["title"] == "Automation")
        .expect("automation section");
    assert!(automation["items"]
        .as_array()
        .expect("items")
        .iter()
        .any(|item| item["label"] == "agent sessions" && item["value"] == "1"));
    assert!(diagnostics["suggestions"]
        .as_array()
        .expect("suggestions")
        .iter()
        .any(|suggestion| suggestion.as_str().unwrap_or_default().contains("/agents")));

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn channels_can_steer_agent_sessions() {
    let store_path = test_store_path("channels");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Watch incoming notes".to_string(),
                title: None,
                source: None,
            })
            .expect("agent session create should work"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();

    let channel = result_value(
        runtime
            .channel_add(ChannelAddParams {
                name: "desktop".to_string(),
                kind: "local".to_string(),
                target_session_id: Some(session_id.clone()),
                enabled: true,
            })
            .expect("channel add should work"),
    );
    let channel_id = channel["channel"]["channelId"]
        .as_str()
        .expect("channel id")
        .to_string();
    result_value(
        runtime
            .channel_push(ChannelPushParams {
                channel_id,
                message: "New file dropped.".to_string(),
                dispatch: false,
            })
            .await
            .expect("channel push should work"),
    );

    let session = result_value(
        runtime
            .agent_session_get(AgentSessionIDParams { session_id })
            .expect("agent session get should work"),
    );
    assert_eq!(session["session"]["lastMessage"], "New file dropped.");

    let _ = std::fs::remove_file(store_path);
}

#[tokio::test]
async fn channel_methods_reject_invalid_inputs_and_skip_dispatch_without_target() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());

    let empty_name = runtime
        .channel_add(ChannelAddParams {
            name: "   ".to_string(),
            kind: "manual".to_string(),
            target_session_id: None,
            enabled: true,
        })
        .expect_err("empty channel name should fail");
    assert_eq!(empty_name.code, -32602);

    let added = result_value(
        runtime
            .channel_add(ChannelAddParams {
                name: "ops".to_string(),
                kind: "manual".to_string(),
                target_session_id: None,
                enabled: true,
            })
            .expect("channel should add"),
    );
    let channel_id = added["channel"]["channelId"]
        .as_str()
        .expect("channel id")
        .to_string();
    let no_dispatch_target = result_value(
        runtime
            .channel_push(ChannelPushParams {
                channel_id: channel_id.clone(),
                message: "broadcast only".to_string(),
                dispatch: true,
            })
            .await
            .expect("dispatch without target should still update channel"),
    );
    assert_eq!(no_dispatch_target["run"], Value::Null);

    let empty_message = runtime
        .channel_push(ChannelPushParams {
            channel_id: channel_id.clone(),
            message: "   ".to_string(),
            dispatch: false,
        })
        .await
        .expect_err("empty channel message should fail");
    assert_eq!(empty_message.code, -32602);
    runtime
        .channel_delete(ChannelIDParams { channel_id })
        .expect("first channel should delete before id-sensitive disabled check");

    let disabled = result_value(
        runtime
            .channel_add(ChannelAddParams {
                name: "disabled".to_string(),
                kind: "manual".to_string(),
                target_session_id: None,
                enabled: false,
            })
            .expect("disabled channel should add"),
    );
    let disabled_id = disabled["channel"]["channelId"]
        .as_str()
        .expect("disabled channel id")
        .to_string();
    let disabled_push = runtime
        .channel_push(ChannelPushParams {
            channel_id: disabled_id,
            message: "blocked".to_string(),
            dispatch: false,
        })
        .await
        .expect_err("disabled channel should reject pushes");
    assert_eq!(disabled_push.message, "channel is disabled");
}

#[tokio::test]
async fn channel_push_can_dispatch_target_agent_session() {
    let store_path = test_store_path("channel-dispatch");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");
    let created = result_value(
        runtime
            .agent_session_create(AgentSessionCreateParams {
                objective: "Handle channel events".to_string(),
                title: None,
                source: None,
            })
            .expect("agent session create should work"),
    );
    let session_id = created["session"]["sessionId"]
        .as_str()
        .expect("session id")
        .to_string();

    let channel = result_value(
        runtime
            .channel_add(ChannelAddParams {
                name: "desktop".to_string(),
                kind: "local".to_string(),
                target_session_id: Some(session_id.clone()),
                enabled: true,
            })
            .expect("channel add should work"),
    );
    let channel_id = channel["channel"]["channelId"]
        .as_str()
        .expect("channel id")
        .to_string();

    let pushed = result_value(
        runtime
            .channel_push(ChannelPushParams {
                channel_id,
                message: "Dispatch this note.".to_string(),
                dispatch: true,
            })
            .await
            .expect("channel dispatch should work"),
    );

    assert_eq!(pushed["session"]["sessionId"], session_id);
    assert_eq!(pushed["run"]["prompt"], "Dispatch this note.");
    assert_eq!(pushed["channel"]["lastMessage"], "Dispatch this note.");

    let session = result_value(
        runtime
            .agent_session_get(AgentSessionIDParams { session_id })
            .expect("agent session get should work"),
    );
    assert_eq!(session["session"]["activeRunId"], pushed["run"]["id"]);

    let _ = std::fs::remove_file(store_path);
}

#[test]
fn schedules_round_trip_and_toggle_enabled() {
    let store_path = test_store_path("schedules");
    let config = RuntimeConfig::default().with_run_store_path(&store_path);
    let mut runtime = AppRuntime::try_new(config).expect("runtime should start");

    let schedule = result_value(
        runtime
            .schedule_add(ScheduleAddParams {
                name: "daily triage".to_string(),
                prompt: "triage stale background sessions".to_string(),
                cadence: "daily".to_string(),
                target_session_id: None,
                enabled: true,
            })
            .expect("schedule add should work"),
    );
    let schedule_id = schedule["schedule"]["scheduleId"]
        .as_str()
        .expect("schedule id")
        .to_string();

    let disabled = result_value(
        runtime
            .schedule_disable(ScheduleIDParams {
                schedule_id: schedule_id.clone(),
            })
            .expect("schedule disable should work"),
    );
    assert_eq!(disabled["schedule"]["enabled"], false);

    let enabled = result_value(
        runtime
            .schedule_enable(ScheduleIDParams {
                schedule_id: schedule_id.clone(),
            })
            .expect("schedule enable should work"),
    );
    assert_eq!(enabled["schedule"]["enabled"], true);

    result_value(
        runtime
            .schedule_delete(ScheduleIDParams { schedule_id })
            .expect("schedule delete should work"),
    );
    let listed = result_value(runtime.schedule_list().expect("schedule list should work"));
    assert_eq!(listed["schedules"].as_array().expect("schedules").len(), 0);

    let _ = std::fs::remove_file(store_path);
}
