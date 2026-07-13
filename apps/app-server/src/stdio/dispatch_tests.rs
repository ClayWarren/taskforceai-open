use serde_json::json;

use crate::protocol::*;
use crate::runtime::{AppRuntime, RuntimeConfig};

use super::dispatch::dispatch;
use super::ServerAction;

#[tokio::test]
async fn dispatch_covers_direct_request_variants() {
    let git_workspace = std::env::temp_dir().display().to_string();
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: "http://127.0.0.1:9".to_string(),
        ollama_base_url: "http://127.0.0.1:9/v1".to_string(),
        ..RuntimeConfig::default()
    });
    let imported_thread: ThreadRecord = serde_json::from_value(json!({
        "id":"dispatch-thread", "title":"Dispatch", "objective":"Exercise dispatch",
        "state":"active", "archived":false, "source":"test", "taskMode":"work",
        "parentThreadId":null, "turns":[], "createdAt":1, "updatedAt":1
    }))
    .expect("thread fixture");

    for request in [
        AppRequest::Initialized,
        AppRequest::ConfigGet,
        AppRequest::AuthStatus,
        AppRequest::AuthLogout,
        AppRequest::AuthDeviceStart,
        AppRequest::AuthDevicePoll(DeviceLoginPollParams {
            device_code: "device".to_string(),
        }),
        AppRequest::ApiHealth,
        AppRequest::AutonomousModeGet,
        AppRequest::AutonomousModeSet(RunModeSetParams { enabled: true }),
        AppRequest::ComputerUseModeGet,
        AppRequest::ComputerUseModeSet(RunModeSetParams { enabled: true }),
        AppRequest::GitReviewStatus(GitReviewStatusParams {
            workspace: Some(git_workspace.clone()),
        }),
        AppRequest::GitReviewDiff(GitReviewDiffParams {
            workspace: Some(git_workspace),
            scope: GitReviewScope::Uncommitted,
            base_ref: None,
            max_bytes: Some(4096),
            thread_id: None,
        }),
        AppRequest::GitReviewStage(GitReviewStageParams {
            workspace: Some(std::env::temp_dir().display().to_string()),
            paths: Vec::new(),
            staged: true,
        }),
        AppRequest::GitReviewCommentList(GitReviewCommentListParams::default()),
        AppRequest::GitReviewCommentAdd(GitReviewCommentAddParams {
            workspace: None,
            path: "missing.rs".into(),
            line: 1,
            end_line: None,
            body: "note".into(),
        }),
        AppRequest::GitReviewCommentResolve(GitReviewCommentResolveParams {
            comment_id: "missing".into(),
            resolved: true,
        }),
        AppRequest::GitReviewPullRequestAction(GitReviewPullRequestActionParams {
            workspace: None,
            action: GitReviewPullRequestAction::Comment,
            body: Some("note".into()),
        }),
        AppRequest::WorkspaceFileList(WorkspaceFileListParams {
            workspace: Some(std::env::temp_dir().display().to_string()),
            query: None,
            limit: Some(1),
        }),
        AppRequest::WorkspaceFileRead(WorkspaceFileReadParams {
            workspace: Some(std::env::temp_dir().display().to_string()),
            path: "missing".into(),
            max_bytes: Some(1),
        }),
        AppRequest::AgentSessionList,
        AppRequest::AgentSessionCreate(AgentSessionCreateParams {
            objective: "Investigate dispatch".to_string(),
            title: Some("Dispatch".to_string()),
            source: None,
            task_mode: Default::default(),
        }),
        AppRequest::AgentSessionGet(agent_id()),
        AppRequest::AgentSessionPause(agent_id()),
        AppRequest::AgentSessionResume(agent_id()),
        AppRequest::AgentSessionCancel(agent_id()),
        AppRequest::AgentSessionMessage(AgentSessionMessageParams {
            session_id: "missing-agent".to_string(),
            message: "note".to_string(),
        }),
        AppRequest::AgentSessionFork(agent_id()),
        AppRequest::AgentSessionRun(AgentSessionRunParams {
            session_id: "missing-agent".to_string(),
            prompt: Some("run".to_string()),
            model_id: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
        }),
        AppRequest::DiagnosticsInspect,
        AppRequest::ThreadResume(ThreadIDParams {
            thread_id: "missing-thread".to_string(),
        }),
        AppRequest::ThreadCancel(ThreadIDParams {
            thread_id: "missing-thread".into(),
        }),
        AppRequest::ThreadFork(ThreadIDParams {
            thread_id: "missing-thread".into(),
        }),
        AppRequest::ThreadRead(ThreadIDParams {
            thread_id: "missing-thread".into(),
        }),
        AppRequest::ThreadImport(ThreadImportParams {
            thread: imported_thread,
            overwrite: false,
        }),
        AppRequest::ThreadUnarchive(ThreadIDParams {
            thread_id: "missing-thread".into(),
        }),
        AppRequest::ThreadDelete(ThreadIDParams {
            thread_id: "missing-thread".into(),
        }),
        AppRequest::ThreadNameSet(ThreadNameSetParams {
            thread_id: "missing-thread".into(),
            title: "Renamed".into(),
        }),
        AppRequest::ThreadMetadataUpdate(ThreadMetadataUpdateParams {
            thread_id: "missing-thread".into(),
            title: Some("Updated".into()),
            objective: None,
        }),
        AppRequest::ThreadRollback(ThreadRollbackParams {
            thread_id: "missing-thread".into(),
            turn_id: "missing-turn".into(),
        }),
        AppRequest::ChannelList,
        AppRequest::ChannelAdd(ChannelAddParams {
            name: "dispatch".to_string(),
            kind: "local".to_string(),
            target_session_id: None,
            enabled: true,
        }),
        AppRequest::ChannelDelete(ChannelIDParams {
            channel_id: "missing-channel".to_string(),
        }),
        AppRequest::ChannelPush(ChannelPushParams {
            channel_id: "missing-channel".to_string(),
            message: "hello".to_string(),
            dispatch: false,
        }),
        AppRequest::ScheduleList,
        AppRequest::ScheduleAdd(ScheduleAddParams {
            name: "dispatch".to_string(),
            prompt: "check".to_string(),
            cadence: "1h".to_string(),
            target_session_id: None,
            enabled: true,
        }),
        AppRequest::ScheduleDelete(schedule_id()),
        AppRequest::ScheduleEnable(schedule_id()),
        AppRequest::ScheduleDisable(schedule_id()),
        AppRequest::ScheduleTick(ScheduleTickParams { now: Some(1) }),
        AppRequest::WorkflowList,
        AppRequest::WorkflowSave(WorkflowSaveParams {
            workflow: workflow_record(),
        }),
        AppRequest::WorkflowGet(workflow_id()),
        AppRequest::WorkflowDelete(WorkflowIDParams {
            workflow_id: "missing-workflow".to_string(),
        }),
        AppRequest::WorkflowRun(WorkflowRunParams {
            workflow_id: "missing-workflow".to_string(),
            args: json!({}),
        }),
        AppRequest::WorkflowRunList,
        AppRequest::WorkflowRunGet(workflow_run_id()),
        AppRequest::WorkflowRunPause(workflow_run_id()),
        AppRequest::WorkflowRunResume(workflow_run_id()),
        AppRequest::WorkflowRunCancel(workflow_run_id()),
        AppRequest::RemoteSettingsCommand(RemoteSettingsCommandParams {
            area: "account".to_string(),
            args: Vec::new(),
        }),
        AppRequest::OllamaStatus(OllamaStatusParams {
            base_url: Some("http://127.0.0.1:9/v1".to_string()),
        }),
        AppRequest::OllamaEnsure(OllamaEnsureParams {
            base_url: Some("http://127.0.0.1:9/v1".to_string()),
            model_id: Some("gemma4:e2b".to_string()),
        }),
        AppRequest::PluginSetEnabled(PluginSetEnabledParams {
            plugin_id: "browser@openai-bundled".to_string(),
            enabled: false,
        }),
        AppRequest::SkillSetEnabled(SkillSetEnabledParams {
            path: "missing/SKILL.md".into(),
            enabled: false,
        }),
        AppRequest::SkillRootsSet(SkillRootsSetParams { roots: Vec::new() }),
        AppRequest::SkillWatch(SkillWatchParams::default()),
        AppRequest::AttachmentAdd(AttachmentAddParams {
            path: "missing.txt".to_string(),
        }),
        AppRequest::ConversationList(ConversationListParams { limit: 5 }),
        AppRequest::MessageList(ConversationIDParams {
            conversation_id: "missing-conversation".to_string(),
        }),
        AppRequest::PromptQueueDispatchAfterResponse(PromptQueueDispatchAfterResponseParams {
            conversation_id: None,
        }),
        AppRequest::MetadataGet(MetadataGetParams {
            key: "local_settings".to_string(),
        }),
        AppRequest::MetadataSet(MetadataSetParams {
            key: "local_settings".to_string(),
            value: "{}".to_string(),
        }),
        AppRequest::SyncPush(SyncPushParams {
            conversations: Vec::new(),
            messages: Vec::new(),
            deletions: Vec::new(),
            new_version: Some(1),
        }),
        AppRequest::DesktopSyncPull(DesktopSyncPullParams {
            device_id: "device".to_string(),
            last_sync_version: 0,
            limit: Some(10),
        }),
        AppRequest::DesktopSyncPush(DesktopSyncPushParams {
            conversations: Vec::new(),
            messages: Vec::new(),
            deletions: Vec::new(),
            device_id: "device".to_string(),
        }),
        AppRequest::VoiceTranscribe(VoiceTranscribeParams {
            audio_base64: "AA==".to_string(),
            media_type: "audio/wav".to_string(),
            file_name: None,
        }),
        AppRequest::VoiceSpeechGenerate(VoiceSpeechGenerateParams {
            text: "hello".to_string(),
        }),
        AppRequest::VoiceRealtimeSetup(VoiceRealtimeSetupParams::default()),
        AppRequest::RunStatus(RunIDParams {
            run_id: "missing-run".to_string(),
        }),
        AppRequest::RunDelete(RunIDParams {
            run_id: "missing-run".to_string(),
        }),
        AppRequest::PendingPromptDelete(PendingPromptIDParams {
            pending_prompt_id: "missing-prompt".to_string(),
        }),
        AppRequest::ProjectCreate(ProjectCreateParams {
            name: "dispatch".to_string(),
            description: None,
            custom_instructions: None,
            workspace_roots: Vec::new(),
        }),
        AppRequest::ProjectDelete(ProjectIDParams { project_id: 1 }),
        AppRequest::McpEnable(McpServerParams {
            name: "missing".to_string(),
        }),
        AppRequest::McpDisable(McpServerParams {
            name: "missing".to_string(),
        }),
        AppRequest::McpRemove(McpServerParams {
            name: "missing".to_string(),
        }),
        AppRequest::McpTools(McpServerToolsParams {
            name: "missing".to_string(),
            tools: Vec::new(),
        }),
        AppRequest::McpInspect(McpServerParams {
            name: "missing".to_string(),
        }),
        AppRequest::McpCallTool(McpToolCallParams {
            name: "missing".to_string(),
            tool: "read".to_string(),
            input: json!({}),
        }),
        AppRequest::McpResourceRead(McpResourceReadParams {
            name: "missing".into(),
            uri: "file:///missing".into(),
        }),
        AppRequest::McpReload,
        AppRequest::McpAuthSet(McpAuthSetParams {
            name: "missing".into(),
            access_token: "token".into(),
        }),
        AppRequest::McpAuthClear(McpServerParams {
            name: "missing".into(),
        }),
        AppRequest::SyncRealtimePoll(SyncRealtimePollParams {
            last_event_id: Some("0-0".to_string()),
        }),
    ] {
        let (_, action) = dispatch(request, Some(json!("dispatch")), false, &mut runtime).await;
        assert_eq!(action, ServerAction::Continue);
    }
}

fn agent_id() -> AgentSessionIDParams {
    AgentSessionIDParams {
        session_id: "missing-agent".to_string(),
    }
}

fn schedule_id() -> ScheduleIDParams {
    ScheduleIDParams {
        schedule_id: "missing-schedule".to_string(),
    }
}

fn workflow_id() -> WorkflowIDParams {
    WorkflowIDParams {
        workflow_id: "dispatch-workflow".to_string(),
    }
}

fn workflow_run_id() -> WorkflowRunIDParams {
    WorkflowRunIDParams {
        run_id: "missing-workflow-run".to_string(),
    }
}

fn workflow_record() -> WorkflowDefinitionRecord {
    WorkflowDefinitionRecord {
        workflow_id: "dispatch-workflow".to_string(),
        name: "Dispatch Workflow".to_string(),
        description: None,
        version: "1.0.0".to_string(),
        visibility: WorkflowVisibility::Personal,
        args_schema: None,
        budget: None,
        phases: vec![WorkflowPhaseDefinition {
            phase_id: "prompt".to_string(),
            name: "Prompt".to_string(),
            kind: WorkflowPhaseKind::Prompt,
            prompt: Some("Do it".to_string()),
            depends_on: Vec::new(),
            agent_count: None,
            output_schema: None,
        }],
        output_schema: None,
        tags: Vec::new(),
        created_at: 1,
        updated_at: 1,
    }
}
