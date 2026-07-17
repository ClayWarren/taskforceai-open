use serde_json::Value;

use crate::protocol::{AppRequest, AppResponse, OutgoingMessage};
use crate::runtime::{AppRuntime, RuntimeError};

use super::responses::{
    error_response, messages_for_success, response_for_notification, runtime_error_response,
};
use super::ServerAction;

pub(super) async fn dispatch(
    request: AppRequest,
    id: Option<Value>,
    is_notification: bool,
    runtime: &mut AppRuntime,
) -> (Vec<OutgoingMessage>, ServerAction) {
    let result = match request {
        AppRequest::Initialize(params) => Ok(runtime.initialize(params)),
        AppRequest::Initialized => Ok(AppResponse::Value(Value::Null)),
        AppRequest::Ping => Ok(runtime.ping()),
        AppRequest::ServerDescribe => Ok(runtime.server_describe()),
        AppRequest::Shutdown => Ok(runtime.shutdown()),
        AppRequest::ConfigGet => Ok(runtime.config_get()),
        AppRequest::ConfigRead(params) => runtime.config_read(params),
        AppRequest::ConfigWrite(params) => runtime.config_write(params),
        AppRequest::ConfigBatchWrite(params) => runtime.config_batch_write(params),
        AppRequest::ConfigReload => runtime.config_reload(),
        AppRequest::AuthStatus => Ok(runtime.auth_status()),
        AppRequest::AuthLogout => runtime.auth_logout(),
        request @ (AppRequest::AuthDeviceStart
        | AppRequest::AuthDevicePoll(_)
        | AppRequest::ApiHealth
        | AppRequest::CommandExecute(_)
        | AppRequest::AgentSessionRun(_)
        | AppRequest::TurnStart(_)
        | AppRequest::TurnSteer(_)
        | AppRequest::ChannelPush(_)
        | AppRequest::ScheduleTick(_)
        | AppRequest::WorkflowRun(_)
        | AppRequest::RemoteSettingsCommand(_)
        | AppRequest::ModelList
        | AppRequest::ModelSelect(_)
        | AppRequest::ModelReset
        | AppRequest::ModelProviderList
        | AppRequest::IntegrationList
        | AppRequest::IntegrationGet(_)
        | AppRequest::IntegrationConnect(_)
        | AppRequest::IntegrationDisconnect(_)
        | AppRequest::OllamaStatus(_)
        | AppRequest::OllamaEnsure(_)
        | AppRequest::AttachmentAdd(_)
        | AppRequest::PromptQueueAdd(_)
        | AppRequest::PromptQueueDispatchAfterResponse(_)) => {
            dispatch_interactive_request(request, runtime).await
        }
        AppRequest::QuickModeGet => runtime.quick_mode_get(),
        AppRequest::QuickModeSet(params) => runtime.quick_mode_set(params),
        AppRequest::AutonomousModeGet => runtime.autonomous_mode_get(),
        AppRequest::AutonomousModeSet(params) => runtime.autonomous_mode_set(params),
        AppRequest::ComputerUseModeGet => runtime.computer_use_mode_get(),
        AppRequest::ComputerUseModeSet(params) => runtime.computer_use_mode_set(params),
        AppRequest::GoalGet => runtime.goal_get(),
        AppRequest::GoalSet(params) => runtime.goal_set(params),
        AppRequest::GoalPause => runtime.goal_pause(),
        AppRequest::GoalResume => runtime.goal_resume(),
        AppRequest::GoalClear => runtime.goal_clear(),
        AppRequest::GitReviewStatus(params) => runtime.git_review_status(params),
        AppRequest::GitReviewDiff(params) => runtime.git_review_diff(params),
        AppRequest::GitReviewStage(params) => runtime.git_review_stage(params),
        AppRequest::GitReviewCommentList(params) => runtime.git_review_comment_list(params),
        AppRequest::GitReviewCommentAdd(params) => runtime.git_review_comment_add(params),
        AppRequest::GitReviewCommentResolve(params) => runtime.git_review_comment_resolve(params),
        AppRequest::GitReviewPullRequestAction(params) => {
            runtime.git_review_pull_request_action(params)
        }
        AppRequest::WorkspaceFileList(params) => runtime.workspace_file_list(params),
        AppRequest::WorkspaceFileRead(params) => runtime.workspace_file_read(params),
        AppRequest::FsReadDirectory(params) => runtime.fs_read_directory(params),
        AppRequest::FsGetMetadata(params) => runtime.fs_get_metadata(params),
        AppRequest::FsWatch(params) => runtime.fs_watch(params),
        AppRequest::FsUnwatch(params) => runtime.fs_unwatch(params),
        AppRequest::GitBranchList(params) => runtime.git_branch_list(params),
        AppRequest::GitBranchCheckout(params) => runtime.git_branch_checkout(params),
        AppRequest::GitBranchCreate(params) => runtime.git_branch_create(params),
        AppRequest::GitWorktreeList(params) => runtime.git_worktree_list(params),
        AppRequest::GitWorktreeCreate(params) => runtime.git_worktree_create(params),
        AppRequest::GitRepositoryClone(params) => runtime.git_repository_clone(params),
        AppRequest::GitHubRepositoryList(params) => runtime.github_repository_list(params),
        AppRequest::GitRepositoryCommit(params) => runtime.git_repository_commit(params),
        AppRequest::GitRepositoryPull(params) => runtime.git_repository_pull(params),
        AppRequest::GitRepositoryPush(params) => runtime.git_repository_push(params),
        AppRequest::GitPullRequestCreate(params) => runtime.git_pull_request_create(params),
        AppRequest::AgentSessionList => runtime.agent_session_list(),
        AppRequest::AgentModeList => Ok(runtime.agent_mode_list()),
        AppRequest::PermissionProfileList => Ok(runtime.permission_profile_list()),
        AppRequest::PermissionGrantList(params) => Ok(runtime.permission_grant_list(params)),
        AppRequest::PermissionGrantClear(params) => Ok(runtime.permission_grant_clear(params)),
        AppRequest::AgentSessionCreate(params) => runtime.agent_session_create(params),
        AppRequest::AgentSessionGet(params) => runtime.agent_session_get(params),
        AppRequest::AgentSessionPause(params) => runtime.agent_session_pause(params),
        AppRequest::AgentSessionResume(params) => runtime.agent_session_resume(params),
        AppRequest::AgentSessionCancel(params) => runtime.agent_session_cancel(params),
        AppRequest::AgentSessionMessage(params) => runtime.agent_session_message(params),
        AppRequest::AgentSessionFork(params) => runtime.agent_session_fork(params),
        AppRequest::ThreadList(params) => runtime.thread_list(params),
        AppRequest::ThreadChildren(params) => runtime.thread_children(params),
        AppRequest::ThreadStatusList => runtime.thread_status_list(),
        AppRequest::ThreadTurnsList(params) => runtime.thread_turns_list(params),
        AppRequest::ThreadItemsList(params) => runtime.thread_items_list(params),
        AppRequest::ThreadStart(params) => runtime.thread_start(params),
        AppRequest::ThreadResume(params) => runtime.thread_resume(params),
        AppRequest::ThreadArchive(params) => runtime.thread_archive(params),
        AppRequest::ThreadCancel(params) => runtime.thread_cancel(params),
        AppRequest::ThreadFork(params) => runtime.thread_fork(params),
        AppRequest::ThreadRead(params) => runtime.thread_read(params),
        AppRequest::ThreadImport(params) => runtime.thread_import(params),
        AppRequest::ThreadUnarchive(params) => runtime.thread_unarchive(params),
        AppRequest::ThreadDelete(params) => runtime.thread_delete(params),
        AppRequest::ThreadNameSet(params) => runtime.thread_name_set(params),
        AppRequest::ThreadMetadataUpdate(params) => runtime.thread_metadata_update(params),
        AppRequest::ThreadSettingsGet(params) => runtime.thread_settings_get(params),
        AppRequest::ThreadSettingsUpdate(params) => runtime.thread_settings_update(params),
        AppRequest::ThreadUsage(params) => runtime.thread_usage(params),
        AppRequest::TurnDiff(params) => runtime.turn_diff(params),
        AppRequest::ThreadRollback(params) => runtime.thread_rollback(params),
        AppRequest::ThreadCompact(params) => runtime.thread_compact(params),
        AppRequest::TurnInterrupt(params) => runtime.turn_interrupt(params),
        AppRequest::ProcessList => runtime.process_list(),
        AppRequest::ProcessStart(params) => runtime.process_start(params),
        AppRequest::ProcessRead(params) => runtime.process_read(params),
        AppRequest::ProcessWrite(params) => runtime.process_write(params),
        AppRequest::ProcessResize(params) => runtime.process_resize(params),
        AppRequest::ProcessKill(params) => runtime.process_kill(params),
        AppRequest::DiagnosticsInspect => runtime.diagnostics_inspect(),
        AppRequest::DiagnosticsSubmit(params) => runtime.diagnostics_submit(params),
        AppRequest::ServerRequestList(params) => runtime.server_request_list(params).await,
        AppRequest::ChannelList => runtime.channel_list(),
        AppRequest::ChannelAdd(params) => runtime.channel_add(params),
        AppRequest::ChannelDelete(params) => runtime.channel_delete(params),
        AppRequest::ScheduleList => runtime.schedule_list(),
        AppRequest::ScheduleAdd(params) => runtime.schedule_add(params),
        AppRequest::ScheduleDelete(params) => runtime.schedule_delete(params),
        AppRequest::ScheduleEnable(params) => runtime.schedule_enable(params),
        AppRequest::ScheduleDisable(params) => runtime.schedule_disable(params),
        AppRequest::WorkflowList => runtime.workflow_list(),
        AppRequest::WorkflowSave(params) => runtime.workflow_save(params),
        AppRequest::WorkflowGet(params) => runtime.workflow_get(params),
        AppRequest::WorkflowDelete(params) => runtime.workflow_delete(params),
        AppRequest::WorkflowRunList => runtime.workflow_run_list(),
        AppRequest::WorkflowRunGet(params) => runtime.workflow_run_get(params),
        AppRequest::WorkflowRunPause(params) => runtime.workflow_run_pause(params),
        AppRequest::WorkflowRunResume(params) => runtime.workflow_run_resume(params).await,
        AppRequest::WorkflowRunCancel(params) => runtime.workflow_run_cancel(params),
        AppRequest::PetGet => runtime.pet_get(),
        AppRequest::PetSet(params) => runtime.pet_set(params),
        AppRequest::OrchestrationGet => runtime.orchestration_get(),
        AppRequest::OrchestrationSetRole(params) => runtime.orchestration_set_role(params),
        AppRequest::OrchestrationClear => runtime.orchestration_clear(),
        AppRequest::OrchestrationSetBudget(params) => runtime.orchestration_set_budget(params),
        AppRequest::HybridModeGet => runtime.hybrid_mode_get(),
        AppRequest::HybridModeSet(params) => runtime.hybrid_mode_set(params),
        AppRequest::LocalSettingsGet => runtime.local_settings_get(),
        AppRequest::LocalSettingsUpdate(params) => runtime.local_settings_update(params),
        AppRequest::SkillList => runtime.skill_list(),
        AppRequest::SkillSetEnabled(params) => runtime.skill_set_enabled(params),
        AppRequest::SkillRootsSet(params) => runtime.skill_roots_set(params),
        AppRequest::SkillWatch(params) => runtime.skill_watch(params),
        AppRequest::PluginList => runtime.plugin_list(),
        AppRequest::PluginSetEnabled(params) => runtime.plugin_set_enabled(params),
        AppRequest::HookList => runtime.hook_list(),
        AppRequest::HookSet(params) => runtime.hook_set(params),
        AppRequest::HookRemove(params) => runtime.hook_remove(params),
        AppRequest::ComputerUseStatus => Ok(runtime.computer_use_status()),
        AppRequest::BrowserStatus => Ok(runtime.browser_status()),
        AppRequest::AttachmentList => Ok(runtime.attachment_list()),
        AppRequest::AttachmentClear => Ok(runtime.attachment_clear()),
        AppRequest::ConversationList(params) => runtime.conversation_list(params),
        AppRequest::ConversationGet(params) => runtime.conversation_get(params),
        AppRequest::ConversationUpsert(params) => runtime.conversation_upsert(params),
        AppRequest::ConversationReplaceID(params) => runtime.conversation_replace_id(params),
        AppRequest::ConversationDelete(params) => runtime.conversation_delete(params),
        AppRequest::ConversationDeleteAll => runtime.conversation_delete_all(),
        AppRequest::MessageList(params) => runtime.message_list(params),
        AppRequest::MessageGet(params) => runtime.message_get(params),
        AppRequest::MessageUpsert(params) => runtime.message_upsert(params),
        AppRequest::MessageDelete(params) => runtime.message_delete(params),
        AppRequest::PendingChangeList => runtime.pending_change_list(),
        AppRequest::PendingChangeAdd(params) => runtime.pending_change_add(params),
        AppRequest::PendingChangeUpdateData(params) => runtime.pending_change_update_data(params),
        AppRequest::PendingChangeDelete(params) => runtime.pending_change_delete(params),
        AppRequest::PendingChangeClear => runtime.pending_change_clear(),
        AppRequest::PromptQueueList => runtime.prompt_queue_list(),
        AppRequest::PromptQueueDelete(params) => runtime.prompt_queue_delete(params),
        AppRequest::PromptQueueClear => runtime.prompt_queue_clear(),
        AppRequest::MetadataGet(params) => runtime.metadata_get(params),
        AppRequest::MetadataSet(params) => runtime.metadata_set(params),
        AppRequest::MetadataClearAll => runtime.metadata_clear_all(),
        AppRequest::SyncStatus => runtime.sync_status(),
        AppRequest::SyncConfigure(params) => runtime.sync_configure(params),
        AppRequest::SyncEnsureDevice => runtime.sync_ensure_device(),
        request @ (AppRequest::SyncPull(_)
        | AppRequest::ApiRequest(_)
        | AppRequest::SyncPush(_)
        | AppRequest::DesktopSyncPull(_)
        | AppRequest::DesktopSyncPush(_)
        | AppRequest::SyncRealtimePoll(_)
        | AppRequest::RemoteSettingsUpdate(_)
        | AppRequest::RemotePairingCodeCreate
        | AppRequest::RemoteControllerList
        | AppRequest::RemoteControllerRevoke(_)
        | AppRequest::VoiceTranscribe(_)
        | AppRequest::VoiceSpeechGenerate(_)
        | AppRequest::VoiceRealtimeSetup(_)
        | AppRequest::RunSubmit(_)
        | AppRequest::PendingPromptReplay
        | AppRequest::ProjectList
        | AppRequest::ProjectCreate(_)
        | AppRequest::ProjectDelete(_)
        | AppRequest::McpInspect(_)
        | AppRequest::McpServerStatusList(_)
        | AppRequest::McpCallTool(_)
        | AppRequest::McpResourceRead(_)
        | AppRequest::McpReload
        | AppRequest::McpAuthSet(_)
        | AppRequest::McpAuthClear(_)
        | AppRequest::McpOAuthStart(_)
        | AppRequest::McpOAuthComplete(_)
        | AppRequest::McpOAuthStatus(_)) => dispatch_connected_request(request, runtime).await,
        AppRequest::RemoteSettingsGet => runtime.remote_settings_get(),
        AppRequest::UsageSummary => Ok(runtime.usage_summary()),
        AppRequest::StatusSummary => runtime.status_summary(),
        AppRequest::HistoryList(params) => Ok(runtime.history_list(params)),
        AppRequest::RunSearch(params) => Ok(runtime.run_search(params)),
        AppRequest::RunStatus(params) => runtime.run_status(params),
        AppRequest::RunCancel(params) => runtime.run_cancel(params),
        AppRequest::RunDelete(params) => runtime.run_delete(params),
        AppRequest::PendingPromptList => Ok(runtime.pending_prompt_list()),
        AppRequest::PendingPromptAdd(params) => runtime.pending_prompt_add(params),
        AppRequest::PendingPromptDelete(params) => runtime.pending_prompt_delete(params),
        AppRequest::ProjectWorkspaceSet(params) => runtime.project_workspace_set(params),
        AppRequest::ProjectUse(params) => runtime.project_use(params),
        AppRequest::ProjectClear => runtime.project_clear(),
        AppRequest::ContextSummary => Ok(runtime.context_summary()),
        AppRequest::MemorySummary => Ok(runtime.memory_summary()),
        AppRequest::McpList => runtime.mcp_list(),
        AppRequest::McpAdd(params) => runtime.mcp_add(params),
        AppRequest::McpRemove(params) => runtime.mcp_remove(params),
        AppRequest::McpEnable(params) => runtime.mcp_enable(params),
        AppRequest::McpDisable(params) => runtime.mcp_disable(params),
        AppRequest::McpTools(params) => runtime.mcp_tools(params),
        AppRequest::McpAvailable => runtime.mcp_available(),
        AppRequest::Unsupported => {
            return (
                response_for_notification(
                    is_notification,
                    error_response(id, -32601, "Method not found"),
                ),
                ServerAction::Continue,
            );
        }
    };

    match result {
        Ok(AppResponse::Shutdown(result)) => (
            messages_for_success(id, is_notification, result, Vec::new()),
            ServerAction::Shutdown,
        ),
        Ok(AppResponse::Value(result)) => (
            messages_for_success(id, is_notification, result, Vec::new()),
            ServerAction::Continue,
        ),
        Ok(AppResponse::WithEvents { result, events }) => (
            messages_for_success(id, is_notification, result, events),
            ServerAction::Continue,
        ),
        Err(err) => (
            response_for_notification(is_notification, runtime_error_response(id, err)),
            ServerAction::Continue,
        ),
    }
}

async fn dispatch_interactive_request(
    request: AppRequest,
    runtime: &mut AppRuntime,
) -> Result<AppResponse, RuntimeError> {
    match request {
        AppRequest::AuthDeviceStart => runtime.auth_device_start().await,
        AppRequest::AuthDevicePoll(params) => runtime.auth_device_poll(params).await,
        AppRequest::ApiHealth => runtime.api_health().await,
        AppRequest::CommandExecute(params) => runtime.command_execute(params).await,
        AppRequest::AgentSessionRun(params) => runtime.agent_session_run(params).await,
        AppRequest::TurnStart(params) => runtime.turn_start(params).await,
        AppRequest::TurnSteer(params) => runtime.turn_steer(params).await,
        AppRequest::ChannelPush(params) => runtime.channel_push(params).await,
        AppRequest::ScheduleTick(params) => runtime.schedule_tick(params).await,
        AppRequest::WorkflowRun(params) => runtime.workflow_run(params).await,
        AppRequest::RemoteSettingsCommand(params) => runtime.remote_settings_command(params).await,
        AppRequest::ModelList => runtime.model_list().await,
        AppRequest::ModelSelect(params) => runtime.model_select(params).await,
        AppRequest::ModelReset => runtime.model_reset().await,
        AppRequest::ModelProviderList => runtime.model_provider_list().await,
        AppRequest::IntegrationList => runtime.integration_list().await,
        AppRequest::IntegrationGet(params) => runtime.integration_get(params).await,
        AppRequest::IntegrationConnect(params) => runtime.integration_connect(params).await,
        AppRequest::IntegrationDisconnect(params) => runtime.integration_disconnect(params).await,
        AppRequest::OllamaStatus(params) => runtime.ollama_status(params).await,
        AppRequest::OllamaEnsure(params) => runtime.ollama_ensure(params).await,
        AppRequest::AttachmentAdd(params) => runtime.attachment_add(params).await,
        AppRequest::PromptQueueAdd(params) => runtime.prompt_queue_add(params).await,
        AppRequest::PromptQueueDispatchAfterResponse(params) => {
            runtime.prompt_queue_dispatch_after_response(params).await
        }
        _ => unreachable!("interactive request group must be routed by dispatch"), // coverage:ignore-line -- Exhaustive routing invariant.
    }
}

async fn dispatch_connected_request(
    request: AppRequest,
    runtime: &mut AppRuntime,
) -> Result<AppResponse, RuntimeError> {
    match request {
        AppRequest::ApiRequest(params) => runtime.api_request(params).await,
        AppRequest::SyncPull(params) => runtime.sync_pull(params).await,
        AppRequest::SyncPush(params) => runtime.sync_push(params).await,
        AppRequest::DesktopSyncPull(params) => runtime.desktop_sync_pull(params).await,
        AppRequest::DesktopSyncPush(params) => runtime.desktop_sync_push(params).await,
        AppRequest::SyncRealtimePoll(params) => runtime.sync_realtime_poll(params).await,
        AppRequest::RemoteSettingsUpdate(params) => runtime.remote_settings_update(params).await,
        AppRequest::RemotePairingCodeCreate => runtime.remote_pairing_code_create().await,
        AppRequest::RemoteControllerList => runtime.remote_controller_list().await,
        AppRequest::RemoteControllerRevoke(params) => {
            runtime.remote_controller_revoke(params).await
        }
        AppRequest::VoiceTranscribe(params) => runtime.voice_transcribe(params).await,
        AppRequest::VoiceSpeechGenerate(params) => runtime.voice_speech_generate(params).await,
        AppRequest::VoiceRealtimeSetup(params) => runtime.voice_realtime_setup(params).await,
        AppRequest::RunSubmit(params) => runtime.run_submit(params).await,
        AppRequest::PendingPromptReplay => runtime.pending_prompt_replay().await,
        AppRequest::ProjectList => runtime.project_list().await,
        AppRequest::ProjectCreate(params) => runtime.project_create(params).await,
        AppRequest::ProjectDelete(params) => runtime.project_delete(params).await,
        AppRequest::McpInspect(params) => runtime.mcp_inspect(params).await,
        AppRequest::McpServerStatusList(params) => runtime.mcp_server_status_list(params).await,
        AppRequest::McpCallTool(params) => runtime.mcp_call_tool(params).await,
        AppRequest::McpResourceRead(params) => runtime.mcp_resource_read(params).await,
        AppRequest::McpReload => runtime.mcp_reload().await,
        AppRequest::McpAuthSet(params) => runtime.mcp_auth_set(params).await,
        AppRequest::McpAuthClear(params) => runtime.mcp_auth_clear(params).await,
        AppRequest::McpOAuthStart(params) => runtime.mcp_oauth_start(params).await,
        AppRequest::McpOAuthComplete(params) => runtime.mcp_oauth_complete(params).await,
        AppRequest::McpOAuthStatus(params) => runtime.mcp_oauth_status(params).await,
        _ => unreachable!("connected request group must be routed by dispatch"), // coverage:ignore-line -- Exhaustive routing invariant.
    }
}
