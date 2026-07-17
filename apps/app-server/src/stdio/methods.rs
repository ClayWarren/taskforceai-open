use serde::Deserialize;
use serde_json::Value;

use crate::protocol::AppRequest;
use crate::runtime::RuntimeError;

pub(super) fn parse_app_request(method: &str, params: Value) -> Result<AppRequest, RuntimeError> {
    let method = super::registry::legacy_method_name(method);
    let method = method.as_str();
    match method {
        "initialize" => parse_params(params).map(AppRequest::Initialize),
        "initialized" => Ok(AppRequest::Initialized),
        "server.ping" => Ok(AppRequest::Ping),
        "server.describe" | "server/describe" => Ok(AppRequest::ServerDescribe),
        "shutdown" => Ok(AppRequest::Shutdown),
        "config.get" => Ok(AppRequest::ConfigGet),
        "config.read" => parse_params(params).map(AppRequest::ConfigRead),
        "config.value.write" => parse_params(params).map(AppRequest::ConfigWrite),
        "config.batch.write" | "config.batchWrite" => {
            parse_params(params).map(AppRequest::ConfigBatchWrite)
        }
        "config.reload" => Ok(AppRequest::ConfigReload),
        "auth.status" => Ok(AppRequest::AuthStatus),
        "auth.logout" => Ok(AppRequest::AuthLogout),
        "auth.deviceStart" => Ok(AppRequest::AuthDeviceStart),
        "auth.devicePoll" => parse_params(params).map(AppRequest::AuthDevicePoll),
        "api.health" => Ok(AppRequest::ApiHealth),
        "api.request" => parse_params(params).map(AppRequest::ApiRequest),
        "command.execute" => parse_params(params).map(AppRequest::CommandExecute),
        "quickMode.get" => Ok(AppRequest::QuickModeGet),
        "quickMode.set" => parse_params(params).map(AppRequest::QuickModeSet),
        "autonomousMode.get" => Ok(AppRequest::AutonomousModeGet),
        "autonomousMode.set" => parse_params(params).map(AppRequest::AutonomousModeSet),
        "computerUseMode.get" => Ok(AppRequest::ComputerUseModeGet),
        "computerUseMode.set" => parse_params(params).map(AppRequest::ComputerUseModeSet),
        "goal.get" => Ok(AppRequest::GoalGet),
        "goal.set" => parse_params(params).map(AppRequest::GoalSet),
        "goal.pause" => Ok(AppRequest::GoalPause),
        "goal.resume" => Ok(AppRequest::GoalResume),
        "goal.clear" => Ok(AppRequest::GoalClear),
        "git.review.status" => parse_params(params).map(AppRequest::GitReviewStatus),
        "git.review.diff" => parse_params(params).map(AppRequest::GitReviewDiff),
        "git.review.stage" => parse_params(params).map(AppRequest::GitReviewStage),
        "git.review.comment.list" => parse_params(params).map(AppRequest::GitReviewCommentList),
        "git.review.comment.add" => parse_params(params).map(AppRequest::GitReviewCommentAdd),
        "git.review.comment.resolve" => {
            parse_params(params).map(AppRequest::GitReviewCommentResolve)
        }
        "git.review.pullRequest.action" => {
            parse_params(params).map(AppRequest::GitReviewPullRequestAction)
        }
        "workspace.file.list" | "fuzzyFileSearch" => {
            parse_params(params).map(AppRequest::WorkspaceFileList)
        }
        "workspace.file.read" => parse_params(params).map(AppRequest::WorkspaceFileRead),
        "fs.readDirectory" | "fs/readDirectory" => {
            parse_params(params).map(AppRequest::FsReadDirectory)
        }
        "fs.getMetadata" | "fs/getMetadata" => parse_params(params).map(AppRequest::FsGetMetadata),
        "fs.watch" => parse_params(params).map(AppRequest::FsWatch),
        "fs.unwatch" => parse_params(params).map(AppRequest::FsUnwatch),
        "git.branch.list" => parse_params(params).map(AppRequest::GitBranchList),
        "git.branch.checkout" => parse_params(params).map(AppRequest::GitBranchCheckout),
        "git.branch.create" => parse_params(params).map(AppRequest::GitBranchCreate),
        "git.worktree.list" => parse_params(params).map(AppRequest::GitWorktreeList),
        "git.worktree.create" => parse_params(params).map(AppRequest::GitWorktreeCreate),
        "git.repository.clone" => parse_params(params).map(AppRequest::GitRepositoryClone),
        "github.repository.list" => parse_params(params).map(AppRequest::GitHubRepositoryList),
        "git.repository.commit" => parse_params(params).map(AppRequest::GitRepositoryCommit),
        "git.repository.pull" => parse_params(params).map(AppRequest::GitRepositoryPull),
        "git.repository.push" => parse_params(params).map(AppRequest::GitRepositoryPush),
        "git.pullRequest.create" => parse_params(params).map(AppRequest::GitPullRequestCreate),
        "agentSession.list" => Ok(AppRequest::AgentSessionList),
        "agentSession.create" => parse_params(params).map(AppRequest::AgentSessionCreate),
        "agentSession.get" => parse_params(params).map(AppRequest::AgentSessionGet),
        "agentSession.pause" => parse_params(params).map(AppRequest::AgentSessionPause),
        "agentSession.resume" => parse_params(params).map(AppRequest::AgentSessionResume),
        "agentSession.cancel" => parse_params(params).map(AppRequest::AgentSessionCancel),
        "agentSession.message" => parse_params(params).map(AppRequest::AgentSessionMessage),
        "agentSession.fork" => parse_params(params).map(AppRequest::AgentSessionFork),
        "agentSession.run" => parse_params(params).map(AppRequest::AgentSessionRun),
        "agentMode.list" | "agentMode/list" => Ok(AppRequest::AgentModeList),
        "permissionProfile.list" | "permissionProfile/list" => {
            Ok(AppRequest::PermissionProfileList)
        }
        "permissionGrant.list" | "permissionGrant/list" => {
            parse_params(params).map(AppRequest::PermissionGrantList)
        }
        "permissionGrant.clear" | "permissionGrant/clear" => {
            parse_params(params).map(AppRequest::PermissionGrantClear)
        }
        "thread.list" => parse_params(params).map(AppRequest::ThreadList),
        "thread.children" => parse_params(params).map(AppRequest::ThreadChildren),
        "thread.status.list" => Ok(AppRequest::ThreadStatusList),
        "thread.turns.list" => parse_params(params).map(AppRequest::ThreadTurnsList),
        "thread.items.list" => parse_params(params).map(AppRequest::ThreadItemsList),
        "thread.start" | "thread/start" => parse_params(params).map(AppRequest::ThreadStart),
        "thread.resume" | "thread/resume" => parse_params(params).map(AppRequest::ThreadResume),
        "thread.archive" | "thread/archive" => parse_params(params).map(AppRequest::ThreadArchive),
        "thread.cancel" | "thread/cancel" => parse_params(params).map(AppRequest::ThreadCancel),
        "thread.fork" | "thread/fork" => parse_params(params).map(AppRequest::ThreadFork),
        "thread.read" | "thread/read" => parse_params(params).map(AppRequest::ThreadRead),
        "thread.import" | "thread/import" => parse_params(params).map(AppRequest::ThreadImport),
        "thread.unarchive" | "thread/unarchive" => {
            parse_params(params).map(AppRequest::ThreadUnarchive)
        }
        "thread.delete" | "thread/delete" => parse_params(params).map(AppRequest::ThreadDelete),
        "thread.name.set" | "thread/name/set" => {
            parse_params(params).map(AppRequest::ThreadNameSet)
        }
        "thread.metadata.update" | "thread/metadata/update" => {
            parse_params(params).map(AppRequest::ThreadMetadataUpdate)
        }
        "thread.settings.get" => parse_params(params).map(AppRequest::ThreadSettingsGet),
        "thread.settings.update" => parse_params(params).map(AppRequest::ThreadSettingsUpdate),
        "thread.tokenUsage" | "thread.usage" => parse_params(params).map(AppRequest::ThreadUsage),
        "turn.diff" | "thread.diff" => parse_params(params).map(AppRequest::TurnDiff),
        "thread.rollback" | "thread/rollback" => {
            parse_params(params).map(AppRequest::ThreadRollback)
        }
        "thread.compact.start" | "thread.compact" => {
            parse_params(params).map(AppRequest::ThreadCompact)
        }
        "turn.start" | "turn/start" => parse_params(params).map(AppRequest::TurnStart),
        "turn.steer" | "turn/steer" => parse_params(params).map(AppRequest::TurnSteer),
        "turn.interrupt" | "turn/interrupt" => parse_params(params).map(AppRequest::TurnInterrupt),
        "diagnostics.inspect" => Ok(AppRequest::DiagnosticsInspect),
        "diagnostics.submit" | "diagnostics/submit" | "feedback/upload" => {
            parse_params(params).map(AppRequest::DiagnosticsSubmit)
        }
        "serverRequest.list" | "serverRequest/list" => {
            parse_params(params).map(AppRequest::ServerRequestList)
        }
        "channel.list" => Ok(AppRequest::ChannelList),
        "channel.add" => parse_params(params).map(AppRequest::ChannelAdd),
        "channel.delete" => parse_params(params).map(AppRequest::ChannelDelete),
        "channel.push" => parse_params(params).map(AppRequest::ChannelPush),
        "schedule.list" => Ok(AppRequest::ScheduleList),
        "schedule.add" => parse_params(params).map(AppRequest::ScheduleAdd),
        "schedule.delete" => parse_params(params).map(AppRequest::ScheduleDelete),
        "schedule.enable" => parse_params(params).map(AppRequest::ScheduleEnable),
        "schedule.disable" => parse_params(params).map(AppRequest::ScheduleDisable),
        "schedule.tick" => parse_params(params).map(AppRequest::ScheduleTick),
        "workflow.list" => Ok(AppRequest::WorkflowList),
        "workflow.save" => parse_params(params).map(AppRequest::WorkflowSave),
        "workflow.get" => parse_params(params).map(AppRequest::WorkflowGet),
        "workflow.delete" => parse_params(params).map(AppRequest::WorkflowDelete),
        "workflow.run" => parse_params(params).map(AppRequest::WorkflowRun),
        "workflowRun.list" => Ok(AppRequest::WorkflowRunList),
        "workflowRun.get" => parse_params(params).map(AppRequest::WorkflowRunGet),
        "workflowRun.pause" => parse_params(params).map(AppRequest::WorkflowRunPause),
        "workflowRun.resume" => parse_params(params).map(AppRequest::WorkflowRunResume),
        "workflowRun.cancel" => parse_params(params).map(AppRequest::WorkflowRunCancel),
        "pet.get" => Ok(AppRequest::PetGet),
        "pet.set" => parse_params(params).map(AppRequest::PetSet),
        "orchestration.get" => Ok(AppRequest::OrchestrationGet),
        "orchestration.setRole" => parse_params(params).map(AppRequest::OrchestrationSetRole),
        "orchestration.clear" => Ok(AppRequest::OrchestrationClear),
        "orchestration.setBudget" => parse_params(params).map(AppRequest::OrchestrationSetBudget),
        "hybridMode.get" => Ok(AppRequest::HybridModeGet),
        "hybridMode.set" => parse_params(params).map(AppRequest::HybridModeSet),
        "settings.local.get" => Ok(AppRequest::LocalSettingsGet),
        "settings.local.update" => parse_params(params).map(AppRequest::LocalSettingsUpdate),
        "settings.remote.command" => parse_params(params).map(AppRequest::RemoteSettingsCommand),
        "model.list" => Ok(AppRequest::ModelList),
        "model.select" => parse_params(params).map(AppRequest::ModelSelect),
        "model.reset" => Ok(AppRequest::ModelReset),
        "modelProvider.list" | "modelProvider/list" => Ok(AppRequest::ModelProviderList),
        "integration.list" | "integration/list" => Ok(AppRequest::IntegrationList),
        "integration.get" | "integration/get" => {
            parse_params(params).map(AppRequest::IntegrationGet)
        }
        "integration.connect" | "integration/connect" => {
            parse_params(params).map(AppRequest::IntegrationConnect)
        }
        "integration.disconnect" | "integration/disconnect" => {
            parse_params(params).map(AppRequest::IntegrationDisconnect)
        }
        "ollama.status" => parse_params(params).map(AppRequest::OllamaStatus),
        "ollama.ensure" => parse_params(params).map(AppRequest::OllamaEnsure),
        "skill.list" => Ok(AppRequest::SkillList),
        "skill.setEnabled" | "skill/setEnabled" => {
            parse_params(params).map(AppRequest::SkillSetEnabled)
        }
        "skill.roots.set" | "skill/roots/set" => {
            parse_params(params).map(AppRequest::SkillRootsSet)
        }
        "skill.watch" | "skill/watch" => parse_params(params).map(AppRequest::SkillWatch),
        "plugin.list" => Ok(AppRequest::PluginList),
        "plugin.setEnabled" => parse_params(params).map(AppRequest::PluginSetEnabled),
        "hooks.list" | "hook.list" => Ok(AppRequest::HookList),
        "hooks.set" | "hook.set" => parse_params(params).map(AppRequest::HookSet),
        "hooks.remove" | "hook.remove" => parse_params(params).map(AppRequest::HookRemove),
        "computerUse.status" => Ok(AppRequest::ComputerUseStatus),
        "browser.status" => Ok(AppRequest::BrowserStatus),
        "attachment.list" => Ok(AppRequest::AttachmentList),
        "attachment.add" => parse_params(params).map(AppRequest::AttachmentAdd),
        "attachment.clear" => Ok(AppRequest::AttachmentClear),
        "conversation.list" => parse_params(params).map(AppRequest::ConversationList),
        "conversation.get" => parse_params(params).map(AppRequest::ConversationGet),
        "conversation.upsert" => parse_params(params).map(AppRequest::ConversationUpsert),
        "conversation.replaceId" => parse_params(params).map(AppRequest::ConversationReplaceID),
        "conversation.delete" => parse_params(params).map(AppRequest::ConversationDelete),
        "conversation.deleteAll" => Ok(AppRequest::ConversationDeleteAll),
        "message.list" => parse_params(params).map(AppRequest::MessageList),
        "message.get" => parse_params(params).map(AppRequest::MessageGet),
        "message.upsert" => parse_params(params).map(AppRequest::MessageUpsert),
        "message.delete" => parse_params(params).map(AppRequest::MessageDelete),
        "pendingChange.list" => Ok(AppRequest::PendingChangeList),
        "pendingChange.add" => parse_params(params).map(AppRequest::PendingChangeAdd),
        "pendingChange.updateData" => parse_params(params).map(AppRequest::PendingChangeUpdateData),
        "pendingChange.delete" => parse_params(params).map(AppRequest::PendingChangeDelete),
        "pendingChange.clear" => Ok(AppRequest::PendingChangeClear),
        "promptQueue.list" => Ok(AppRequest::PromptQueueList),
        "promptQueue.add" => parse_params(params).map(AppRequest::PromptQueueAdd),
        "promptQueue.delete" => parse_params(params).map(AppRequest::PromptQueueDelete),
        "promptQueue.clear" => Ok(AppRequest::PromptQueueClear),
        "promptQueue.dispatchAfterResponse" => {
            parse_params(params).map(AppRequest::PromptQueueDispatchAfterResponse)
            // coverage:ignore-line
            // coverage:ignore-line
        }
        "metadata.get" => parse_params(params).map(AppRequest::MetadataGet),
        "metadata.set" => parse_params(params).map(AppRequest::MetadataSet),
        "metadata.clearAll" => Ok(AppRequest::MetadataClearAll),
        "sync.status" => Ok(AppRequest::SyncStatus),
        "sync.configure" => parse_params(params).map(AppRequest::SyncConfigure),
        "sync.ensureDevice" => Ok(AppRequest::SyncEnsureDevice),
        "sync.pull" => parse_params(params).map(AppRequest::SyncPull),
        "sync.push" => parse_params(params).map(AppRequest::SyncPush),
        "desktopSync.pull" => parse_params(params).map(AppRequest::DesktopSyncPull),
        "desktopSync.push" => parse_params(params).map(AppRequest::DesktopSyncPush),
        "sync.realtimePoll" | "sync.run" => parse_params(params).map(AppRequest::SyncRealtimePoll),
        "remote.settings.get" => Ok(AppRequest::RemoteSettingsGet),
        "remote.settings.update" => parse_params(params).map(AppRequest::RemoteSettingsUpdate),
        "remote.pairingCode.create" => Ok(AppRequest::RemotePairingCodeCreate),
        "remote.controller.list" => Ok(AppRequest::RemoteControllerList),
        "remote.controller.revoke" => parse_params(params).map(AppRequest::RemoteControllerRevoke),
        "voice.transcribe" => parse_params(params).map(AppRequest::VoiceTranscribe),
        "voice.speechGenerate" => parse_params(params).map(AppRequest::VoiceSpeechGenerate),
        "voice.realtimeSetup" => parse_params(params).map(AppRequest::VoiceRealtimeSetup),
        "usage.summary" => Ok(AppRequest::UsageSummary),
        "status.summary" => Ok(AppRequest::StatusSummary),
        "history.list" => parse_params(params).map(AppRequest::HistoryList),
        "run.search" => parse_params(params).map(AppRequest::RunSearch),
        "run.submit" => parse_params(params).map(AppRequest::RunSubmit),
        "run.status" => parse_params(params).map(AppRequest::RunStatus),
        "run.cancel" => parse_params(params).map(AppRequest::RunCancel),
        "run.delete" => parse_params(params).map(AppRequest::RunDelete),
        "pendingPrompt.list" => Ok(AppRequest::PendingPromptList),
        "pendingPrompt.add" => parse_params(params).map(AppRequest::PendingPromptAdd),
        "pendingPrompt.delete" => parse_params(params).map(AppRequest::PendingPromptDelete),
        "pendingPrompt.replay" => Ok(AppRequest::PendingPromptReplay),
        "project.list" => Ok(AppRequest::ProjectList),
        "project.create" => parse_params(params).map(AppRequest::ProjectCreate),
        "project.workspace.set" => parse_params(params).map(AppRequest::ProjectWorkspaceSet),
        "project.delete" => parse_params(params).map(AppRequest::ProjectDelete),
        "project.use" => parse_params(params).map(AppRequest::ProjectUse),
        "project.clear" => Ok(AppRequest::ProjectClear),
        "context.summary" => Ok(AppRequest::ContextSummary),
        "memory.summary" => Ok(AppRequest::MemorySummary),
        "mcp.list" => Ok(AppRequest::McpList),
        "mcp.add" => parse_params(params).map(AppRequest::McpAdd),
        "mcp.remove" => parse_params(params).map(AppRequest::McpRemove),
        "mcp.enable" => parse_params(params).map(AppRequest::McpEnable),
        "mcp.disable" => parse_params(params).map(AppRequest::McpDisable),
        "mcp.tools" => parse_params(params).map(AppRequest::McpTools),
        "mcp.available" | "mcp.discover" => Ok(AppRequest::McpAvailable),
        "mcp.inspect" => parse_params(params).map(AppRequest::McpInspect),
        "mcpServerStatus.list" | "mcpServerStatus/list" => {
            parse_params(params).map(AppRequest::McpServerStatusList)
        }
        "mcp.callTool" => parse_params(params).map(AppRequest::McpCallTool),
        "mcp.resourceRead" | "mcp.resource.read" => {
            parse_params(params).map(AppRequest::McpResourceRead)
        }
        "mcp.reload" | "mcp/reload" => Ok(AppRequest::McpReload),
        "mcp.auth.set" | "mcp/auth/set" => parse_params(params).map(AppRequest::McpAuthSet),
        "mcp.auth.clear" | "mcp/auth/clear" => parse_params(params).map(AppRequest::McpAuthClear),
        "mcp.oauth.start" => parse_params(params).map(AppRequest::McpOAuthStart),
        "mcp.oauth.complete" => parse_params(params).map(AppRequest::McpOAuthComplete),
        "mcp.oauth.status" => parse_params(params).map(AppRequest::McpOAuthStatus),
        "process.list" | "pty.list" => Ok(AppRequest::ProcessList),
        "process.start" | "pty.create" => parse_params(params).map(AppRequest::ProcessStart),
        "process.read" | "pty.read" => parse_params(params).map(AppRequest::ProcessRead),
        "process.write" | "pty.write" => parse_params(params).map(AppRequest::ProcessWrite),
        "process.resize" | "pty.resize" => parse_params(params).map(AppRequest::ProcessResize),
        "process.kill" | "pty.delete" => parse_params(params).map(AppRequest::ProcessKill),
        _ => Ok(AppRequest::Unsupported),
    }
}

fn parse_params<T>(params: Value) -> Result<T, RuntimeError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(params).map_err(|err| RuntimeError::invalid_params(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn multiline_and_alias_method_arms_are_classified() {
        for method in [
            "git.review.comment.resolve",
            "git.review.pullRequest.action",
            "thread/unarchive",
            "thread/name/set",
            "thread/metadata/update",
            "thread/rollback",
            "skill/setEnabled",
            "skill.roots.set",
            "skill.watch",
            "mcp/resource/read",
            "mcpServerStatus/list",
        ] {
            let _ = parse_app_request(method, json!({}));
        }
        assert!(matches!(
            parse_app_request("unknown", json!({})).expect("unknown method classification"),
            AppRequest::Unsupported
        ));
        assert!(matches!(
            parse_app_request(
                "mcpServerStatus/list",
                json!({"limit": 10, "detail": "toolsAndAuthOnly"})
            )
            .expect("MCP status list"),
            AppRequest::McpServerStatusList(_)
        ));
        assert!(matches!(
            parse_app_request(
                "mcp/resource/read",
                json!({"name": "docs", "uri": "file:///guide"})
            )
            .expect("resource read alias"),
            AppRequest::McpResourceRead(_)
        ));
        assert!(matches!(
            parse_app_request("thread/compact/start", json!({"threadId": "thread-1"}))
                .expect("compact alias"),
            AppRequest::ThreadCompact(_)
        ));
        assert!(matches!(
            parse_app_request(
                "pty/create",
                json!({
                    "command": "cargo",
                    "cwd": "/tmp/workspace",
                    "workspaceRoot": "/tmp/workspace"
                })
            )
            .expect("PTY alias"),
            AppRequest::ProcessStart(_)
        ));

        for (method, params) in [
            (
                "git.branch.checkout",
                json!({"branch": "topic", "remote": false}),
            ),
            ("git.branch.create", json!({"branch": "topic"})),
            ("git.repository.commit", json!({"message": "message"})),
            ("git.repository.pull", json!({})),
            ("git.repository.push", json!({})),
            ("git.pullRequest.create", json!({"draft": true})),
        ] {
            assert!(!matches!(
                parse_app_request(method, params).expect("Git finish method should parse"),
                AppRequest::Unsupported
            ));
        }
    }
}
