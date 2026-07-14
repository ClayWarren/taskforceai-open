use super::*;

fn run_record(id: &str, status: RunStatus, updated_at: u64) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        prompt: "prompt".to_string(),
        model_id: None,
        project_id: None,
        status,
        output: None,
        error: None,
        created_at: 1,
        updated_at,
        tool_events: Vec::new(),
        sources: Vec::new(),
        agent_statuses: Vec::new(),
        pending_approval: None,
    }
}

#[test]
fn resumes_only_nonterminal_remote_task_ids() {
    let remote = "task_6295f579-e462-4c63-b799-c8bbe344d85e";
    let now = MAX_REMOTE_RUN_RESUME_AGE_MS + 10_000;

    assert!(should_resume_remote_stream(
        &run_record(remote, RunStatus::Processing, now),
        now
    ));
    assert!(should_resume_remote_stream(
        &run_record(remote, RunStatus::Queued, now),
        now
    ));
    assert!(!should_resume_remote_stream(
        &run_record(remote, RunStatus::Completed, now),
        now
    ));
    assert!(!should_resume_remote_stream(
        &run_record("local_run_1", RunStatus::Processing, now),
        now
    ));
    assert!(!should_resume_remote_stream(
        &run_record("task_recorded", RunStatus::Processing, now),
        now
    ));
    assert!(!should_resume_remote_stream(
        &run_record(
            remote,
            RunStatus::Processing,
            now - MAX_REMOTE_RUN_RESUME_AGE_MS - 1
        ),
        now
    ));
}

#[test]
fn stored_computer_use_mode_wins_over_stale_false_param() {
    assert!(resolve_computer_use(Some(false), true));
    assert!(resolve_computer_use(Some(true), false));
    assert!(!resolve_computer_use(None, false));
    assert!(!resolve_computer_use(Some(false), false));
}

#[test]
fn short_text_file_prompts_do_not_route_to_video() {
    assert!(
        resolve_generated_media_route("Create a video showing the changed files", false).is_none()
    );
    assert!(
        resolve_generated_media_route("Create a video showing the changed files", true).is_some()
    );
    assert_eq!(
        resolve_generated_media_route("please edit this attached picture", true)
            .expect("attachment edit should route to image")
            .model_id,
        IMAGE_GENERATION_MODEL_ID
    );
    assert_eq!(
        resolve_generated_media_route("please lip sync this clip", true)
            .expect("attachment lip sync should route to video")
            .model_id,
        VIDEO_GENERATION_MODEL_ID
    );
    assert!(has_any_word("make a poster", "poster flyer"));
    assert!(contains_any_phrase(
        "remove background from this",
        "edit,remove background"
    ));
    assert!(resolve_generated_media_route(
        "Create a folder named demo and write two short lines to demo/notes.txt",
        false
    )
    .is_none());
}

#[tokio::test]
async fn resume_remote_run_streams_spawns_workers_for_authenticated_remote_runs() {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
    let mut runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig {
        api_base_url: "http://127.0.0.1:9".to_string(),
        ..crate::runtime::RuntimeConfig::default()
    });
    runtime.set_event_sender(sender);
    runtime
        .set_auth_token(Some("token"))
        .expect("token should be cached");
    runtime.runs.insert(
        "task_6295f579-e462-4c63-b799-c8bbe344d85e".to_string(),
        run_record(
            "task_6295f579-e462-4c63-b799-c8bbe344d85e",
            RunStatus::Processing,
            unix_millis(),
        ),
    );

    assert_eq!(runtime.resume_remote_run_streams(), 1);

    let update = tokio::time::timeout(std::time::Duration::from_secs(2), receiver.recv())
        .await
        .expect("remote worker should emit failed update")
        .expect("remote worker event should be present");
    match update {
        AppServerEvent::RunUpdated { run } => assert_eq!(run.status, RunStatus::Failed),
        other => panic!("unexpected event: {other:?}"),
    }
}

#[test]
fn resume_remote_run_streams_skips_auth_lookup_without_resumable_runs_or_auth() {
    let mut runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
    assert_eq!(runtime.resume_remote_run_streams(), 0);

    runtime.runs.insert(
        "task_6295f579-e462-4c63-b799-c8bbe344d85e".to_string(),
        run_record(
            "task_6295f579-e462-4c63-b799-c8bbe344d85e",
            RunStatus::Processing,
            unix_millis(),
        ),
    );
    assert_eq!(runtime.resume_remote_run_streams(), 0);
}
