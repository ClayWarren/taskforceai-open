use std::{future::Future, pin::Pin};

use taskforceai_app_client::{AppClientError, AppServerRequestHandle};
use taskforceai_app_protocol::{
    AgentSessionIDParams, AgentSessionListResult, AgentSessionMessageParams, AgentSessionResult,
    ApiRequestParams, ApiRequestResult, AttachmentAddParams, AttachmentAddResult,
    AttachmentListResult, AuthStatus, BrowserStatusResult, ChannelAddParams, ChannelIDParams,
    ChannelListResult, ChannelPushParams, ChannelResult, ComputerUseStatusResult,
    ContextSummaryResult, ConversationIDParams, DeviceLoginPollParams, DeviceLoginPollResult,
    DeviceLoginStartResult, DiagnosticsInspectResult, GitReviewActionResult,
    GitReviewCommentAddParams, GitReviewCommentListParams, GitReviewCommentListResult,
    GitReviewCommentResolveParams, GitReviewCommentResult, GitReviewDiffParams,
    GitReviewDiffResult, GitReviewPullRequestActionParams, GitReviewStageParams,
    GitReviewStatusParams, GitReviewStatusResult, HybridModeResult, InitializeResult,
    LocalSettingsResult, LocalSettingsUpdateParams, MemorySummaryResult, MessageIDParams,
    ModelListResult, PendingChangeListResult, PetResult, PetSetParams, PluginListResult,
    ProcessIDParams, ProcessListResult, ProcessReadParams, ProcessReadResult, ProcessResizeParams,
    ProcessResult, ProcessStartParams, ProcessWriteParams, ProjectCreateParams, ProjectResult,
    ProjectWorkspaceResult, ProjectWorkspaceSetParams, QuickModeResult, RemoteControllerListResult,
    RemoteControllerRevokeParams, RemotePairingCodeResult, RunIDParams, RunStatusResult,
    ScheduleAddParams, ScheduleIDParams, ScheduleListResult, ScheduleResult, ScheduleTickParams,
    ScheduleTickResult, SkillListResult, StatusSummaryResult, SyncDeviceResult, SyncStatusResult,
    ThreadIDParams, ThreadListResult, ThreadResult, TurnInterruptParams, TurnResult,
    TurnSteerParams, VoiceRealtimeSetupParams, VoiceRealtimeSetupResult, VoiceSpeechGenerateParams,
    VoiceSpeechGenerateResult, VoiceTranscribeParams, VoiceTranscribeResult,
};
use tracing::{error, info};

use crate::state::AppState;

mod conversations;
mod environment;
mod history_pending;
mod local_coding;
mod settings_sync;

pub use conversations::*;
pub use environment::*;
pub use history_pending::*;
pub use local_coding::*;
pub use settings_sync::*;

type AppServerFuture<T> = Pin<Box<dyn Future<Output = Result<T, AppClientError>> + Send>>;

pub(super) async fn call_app_server<T>(
    state: tauri::State<'_, AppState>,
    name: &'static str,
    run: impl FnOnce(AppServerRequestHandle) -> AppServerFuture<T>,
) -> Result<T, String> {
    info!(target: "app_server", command = name, "Calling shared app-server command");
    metrics::counter!("app_server.command", "name" => name).increment(1);
    state.app_server.with_client(run).await.map_err(|err| {
        error!(
            target: "app_server",
            command = name,
            error = %err,
            "Shared app-server command failed"
        );
        err.to_string()
    })
}

pub(super) async fn call_local_coding_app_server<T>(
    state: tauri::State<'_, AppState>,
    name: &'static str,
    run: impl FnOnce(AppServerRequestHandle) -> AppServerFuture<T>,
) -> Result<T, String> {
    info!(target: "app_server", command = name, "Calling serialized local-coding app-server command");
    metrics::counter!("app_server.command", "name" => name).increment(1);
    state
        .app_server
        .with_workspace_client(run)
        .await
        .map_err(|err| {
            error!(
                target: "app_server",
                command = name,
                error = %err,
                "Local-coding app-server command failed"
            );
            err.to_string()
        })
}

macro_rules! app_server_getters {
    ($( $command:ident => $client_method:ident -> $result:ty, $metric:literal; )*) => {$(
        #[tauri::command]
        #[tracing::instrument(skip(state), err)]
        pub async fn $command(state: tauri::State<'_, AppState>) -> Result<$result, String> {
            call_app_server(state, $metric, |client| {
                Box::pin(async move { client.$client_method().await })
            })
            .await
        }
    )*};
}

macro_rules! app_server_params {
    ($( $command:ident($arg:ident: $arg_type:ty) => $client_method:ident -> $result:ty, $metric:literal; )*) => {$(
        #[tauri::command]
        #[tracing::instrument(skip(state, $arg), err)]
        pub async fn $command(
            state: tauri::State<'_, AppState>,
            $arg: $arg_type,
        ) -> Result<$result, String> {
            call_app_server(state, $metric, |client| {
                Box::pin(async move { client.$client_method($arg).await })
            })
            .await
        }
    )*};
}

macro_rules! app_server_id_params {
    ($( $command:ident($arg:ident) => $client_method:ident($param_type:ident) -> $result:ty, $metric:literal; )*) => {$(
        #[tauri::command]
        #[tracing::instrument(skip(state), err)]
        pub async fn $command(
            state: tauri::State<'_, AppState>,
            $arg: String,
        ) -> Result<$result, String> {
            call_app_server(state, $metric, |client| {
                Box::pin(async move {
                    client.$client_method($param_type { $arg }).await
                })
            })
            .await
        }
    )*};
}

macro_rules! app_server_id_units {
    ($( $command:ident($arg:ident) => $client_method:ident($param_type:ident), $metric:literal; )*) => {$(
        #[tauri::command]
        #[tracing::instrument(skip(state), err)]
        pub async fn $command(
            state: tauri::State<'_, AppState>,
            $arg: String,
        ) -> Result<(), String> {
            call_app_server(state, $metric, |client| {
                Box::pin(async move {
                    client
                        .$client_method($param_type { $arg })
                        .await
                        .map(|_| ())
                })
            })
            .await
        }
    )*};
}

app_server_getters! {
    app_server_initialize => initialize -> InitializeResult, "initialize";
    app_server_status_summary => status_summary -> StatusSummaryResult, "status_summary";
    app_server_pet_get => pet_get -> PetResult, "pet_get";
    app_server_agent_session_list => agent_session_list -> AgentSessionListResult, "agent_session_list";
    app_server_thread_list => thread_list -> ThreadListResult, "thread_list";
    app_server_diagnostics_inspect => diagnostics_inspect -> DiagnosticsInspectResult, "diagnostics_inspect";
    app_server_channel_list => channel_list -> ChannelListResult, "channel_list";
    app_server_schedule_list => schedule_list -> ScheduleListResult, "schedule_list";
    app_server_auth_status => auth_status -> AuthStatus, "auth_status";
    app_server_auth_device_start => auth_device_start -> DeviceLoginStartResult, "auth_device_start";
    app_server_pending_change_list => pending_change_list -> PendingChangeListResult, "pending_change_list";
    app_server_sync_status => sync_status -> SyncStatusResult, "sync_status";
    app_server_sync_ensure_device => sync_ensure_device -> SyncDeviceResult, "sync_ensure_device";
    app_server_quick_mode_get => quick_mode_get -> QuickModeResult, "quick_mode_get";
    app_server_autonomous_mode_get => autonomous_mode_get -> QuickModeResult, "autonomous_mode_get";
    app_server_computer_use_mode_get => computer_use_mode_get -> QuickModeResult, "computer_use_mode_get";
    app_server_hybrid_mode_get => hybrid_mode_get -> HybridModeResult, "hybrid_mode_get";
    app_server_local_settings_get => local_settings_get -> LocalSettingsResult, "local_settings_get";
    app_server_remote_pairing_code_create => remote_pairing_code_create -> RemotePairingCodeResult, "remote_pairing_code_create";
    app_server_remote_controller_list => remote_controller_list -> RemoteControllerListResult, "remote_controller_list";
    app_server_model_list => model_list -> ModelListResult, "model_list";
    app_server_model_reset => model_reset -> ModelListResult, "model_reset";
    app_server_skill_list => skill_list -> SkillListResult, "skill_list";
    app_server_plugin_list => plugin_list -> PluginListResult, "plugin_list";
    app_server_attachment_list => attachment_list -> AttachmentListResult, "attachment_list";
    app_server_attachment_clear => attachment_clear -> AttachmentListResult, "attachment_clear";
    app_server_computer_use_status => computer_use_status -> ComputerUseStatusResult, "computer_use_status";
    app_server_browser_status => browser_status -> BrowserStatusResult, "browser_status";
    app_server_context_summary => context_summary -> ContextSummaryResult, "context_summary";
    app_server_memory_summary => memory_summary -> MemorySummaryResult, "memory_summary";
}

app_server_params! {
    app_server_api_request(params: ApiRequestParams) => api_request -> ApiRequestResult, "api_request";
    app_server_project_create(params: ProjectCreateParams) => project_create -> ProjectResult, "project_create";
    app_server_project_workspace_set(params: ProjectWorkspaceSetParams) => project_workspace_set -> ProjectWorkspaceResult, "project_workspace_set";
    app_server_pet_set(params: PetSetParams) => pet_set -> PetResult, "pet_set";
    app_server_agent_session_message(params: AgentSessionMessageParams) => agent_session_message -> AgentSessionResult, "agent_session_message";
    app_server_turn_steer(params: TurnSteerParams) => turn_steer -> ThreadResult, "turn_steer";
    app_server_turn_interrupt(params: TurnInterruptParams) => turn_interrupt -> TurnResult, "turn_interrupt";
    app_server_channel_add(params: ChannelAddParams) => channel_add -> ChannelResult, "channel_add";
    app_server_channel_push(params: ChannelPushParams) => channel_push -> ChannelResult, "channel_push";
    app_server_schedule_add(params: ScheduleAddParams) => schedule_add -> ScheduleResult, "schedule_add";
    app_server_schedule_tick(params: ScheduleTickParams) => schedule_tick -> ScheduleTickResult, "schedule_tick";
    app_server_git_review_status(params: GitReviewStatusParams) => git_review_status -> GitReviewStatusResult, "git_review_status";
    app_server_git_review_diff(params: GitReviewDiffParams) => git_review_diff -> GitReviewDiffResult, "git_review_diff";
    app_server_git_review_stage(params: GitReviewStageParams) => git_review_stage -> GitReviewStatusResult, "git_review_stage";
    app_server_git_review_comment_list(params: GitReviewCommentListParams) => git_review_comment_list -> GitReviewCommentListResult, "git_review_comment_list";
    app_server_git_review_comment_add(params: GitReviewCommentAddParams) => git_review_comment_add -> GitReviewCommentResult, "git_review_comment_add";
    app_server_git_review_comment_resolve(params: GitReviewCommentResolveParams) => git_review_comment_resolve -> GitReviewCommentResult, "git_review_comment_resolve";
    app_server_git_review_pull_request_action(params: GitReviewPullRequestActionParams) => git_review_pull_request_action -> GitReviewActionResult, "git_review_pull_request_action";
    app_server_attachment_add(params: AttachmentAddParams) => attachment_add -> AttachmentAddResult, "attachment_add";
    app_server_local_settings_update(params: LocalSettingsUpdateParams) => local_settings_update -> LocalSettingsResult, "local_settings_update";
    app_server_remote_controller_revoke(params: RemoteControllerRevokeParams) => remote_controller_revoke -> serde_json::Value, "remote_controller_revoke";
    app_server_voice_transcribe(params: VoiceTranscribeParams) => voice_transcribe -> VoiceTranscribeResult, "voice_transcribe";
    app_server_voice_speech_generate(params: VoiceSpeechGenerateParams) => voice_speech_generate -> VoiceSpeechGenerateResult, "voice_speech_generate";
    app_server_voice_realtime_setup(params: VoiceRealtimeSetupParams) => voice_realtime_setup -> VoiceRealtimeSetupResult, "voice_realtime_setup";
}

#[tauri::command]
#[tracing::instrument(skip(state, window), err)]
pub async fn app_server_process_list(
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<ProcessListResult, String> {
    super::ui::authorize_terminal_process_bridge(&window)?;
    call_app_server(state, "process_list", |client| {
        Box::pin(async move { client.process_list().await })
    })
    .await
}

macro_rules! authorized_process_params {
    ($( $command:ident($arg:ident: $arg_type:ty) => $client_method:ident -> $result:ty, $metric:literal; )*) => {$(
        #[tauri::command]
        #[tracing::instrument(skip(state, window, $arg), err)]
        pub async fn $command(
            state: tauri::State<'_, AppState>,
            window: tauri::WebviewWindow,
            $arg: $arg_type,
        ) -> Result<$result, String> {
            super::ui::authorize_terminal_process_bridge(&window)?;
            call_app_server(state, $metric, |client| {
                Box::pin(async move { client.$client_method($arg).await })
            })
            .await
        }
    )*};
}

authorized_process_params! {
    app_server_process_start(params: ProcessStartParams) => process_start -> ProcessResult, "process_start";
    app_server_process_read(params: ProcessReadParams) => process_read -> ProcessReadResult, "process_read";
    app_server_process_write(params: ProcessWriteParams) => process_write -> ProcessResult, "process_write";
    app_server_process_resize(params: ProcessResizeParams) => process_resize -> ProcessResult, "process_resize";
    app_server_process_kill(params: ProcessIDParams) => process_kill -> ProcessResult, "process_kill";
}

app_server_id_params! {
    app_server_agent_session_pause(session_id) => agent_session_pause(AgentSessionIDParams) -> AgentSessionResult, "agent_session_pause";
    app_server_agent_session_resume(session_id) => agent_session_resume(AgentSessionIDParams) -> AgentSessionResult, "agent_session_resume";
    app_server_agent_session_cancel(session_id) => agent_session_cancel(AgentSessionIDParams) -> AgentSessionResult, "agent_session_cancel";
    app_server_thread_resume(thread_id) => thread_resume(ThreadIDParams) -> ThreadResult, "thread_resume";
    app_server_thread_archive(thread_id) => thread_archive(ThreadIDParams) -> ThreadResult, "thread_archive";
    app_server_schedule_enable(schedule_id) => schedule_enable(ScheduleIDParams) -> ScheduleResult, "schedule_enable";
    app_server_schedule_disable(schedule_id) => schedule_disable(ScheduleIDParams) -> ScheduleResult, "schedule_disable";
    app_server_auth_device_poll(device_code) => auth_device_poll(DeviceLoginPollParams) -> DeviceLoginPollResult, "auth_device_poll";
    app_server_run_status(run_id) => run_status(RunIDParams) -> RunStatusResult, "run_status";
    app_server_cancel_run(run_id) => run_cancel(RunIDParams) -> RunStatusResult, "cancel_run";
}

app_server_id_units! {
    app_server_channel_delete(channel_id) => channel_delete(ChannelIDParams), "channel_delete";
    app_server_schedule_delete(schedule_id) => schedule_delete(ScheduleIDParams), "schedule_delete";
    app_server_conversation_delete(conversation_id) => conversation_delete(ConversationIDParams), "conversation_delete";
    app_server_message_delete(message_id) => message_delete(MessageIDParams), "message_delete";
}

#[cfg(test)]
mod tests {
    use super::{
        conversations::{conversation_list_params, conversation_replace_id_params},
        history_pending::{history_list_params, pending_change_update_data_params},
        local_coding::enrich_local_coding_submit_params,
        local_coding::{
            enrich_local_coding_agent_session_run_params, enrich_local_coding_turn_start_params,
        },
        settings_sync::{
            desktop_sync_pull_params, desktop_sync_push_params, hybrid_mode_set_params,
            ollama_ensure_params, ollama_status_params, sync_configure_params,
        },
    };
    use serde_json::json;
    use taskforceai_app_protocol::{
        AgentSessionRunParams, ClientMcpTool, SubmitRunParams, TurnStartParams,
    };

    #[test]
    fn history_and_conversation_list_default_to_desktop_limit() {
        assert_eq!(history_list_params(None).limit, 50);
        assert_eq!(conversation_list_params(None).limit, 50);
        assert_eq!(history_list_params(Some(7)).limit, 7);
        assert_eq!(conversation_list_params(Some(9)).limit, 9);
    }

    #[test]
    fn pending_change_and_conversation_id_helpers_preserve_frontend_args() {
        let pending = pending_change_update_data_params(42, json!({"status": "ready"}));
        assert_eq!(pending.id, 42);
        assert_eq!(pending.data["status"], "ready");

        let replace = conversation_replace_id_params("local-1".into(), "remote-1".into());
        assert_eq!(replace.old_conversation_id, "local-1");
        assert_eq!(replace.new_conversation_id, "remote-1");
    }

    #[test]
    fn sync_helpers_preserve_optional_and_required_fields() {
        let configure = sync_configure_params(Some("device-a".into()), Some(123));
        assert_eq!(configure.device_id.as_deref(), Some("device-a"));
        assert_eq!(configure.last_sync_version, Some(123));

        let pull = desktop_sync_pull_params(55, "device-b".into(), Some(25));
        assert_eq!(pull.device_id, "device-b");
        assert_eq!(pull.last_sync_version, 55);
        assert_eq!(pull.limit, Some(25));

        let push = desktop_sync_push_params(
            vec![json!({"conversationId": "c1"})],
            vec![json!({"messageId": "m1"})],
            vec![json!({"id": "d1"})],
            "device-c".into(),
        );
        assert_eq!(push.device_id, "device-c");
        assert_eq!(push.conversations[0]["conversationId"], "c1");
        assert_eq!(push.messages[0]["messageId"], "m1");
        assert_eq!(push.deletions[0]["id"], "d1");
    }

    #[test]
    fn mode_and_ollama_helpers_preserve_frontend_args() {
        let hybrid = hybrid_mode_set_params(true, Some("gpt-5".into()), Some("reviewer".into()));
        assert!(hybrid.enabled);
        assert_eq!(hybrid.model_id.as_deref(), Some("gpt-5"));
        assert_eq!(hybrid.role.as_deref(), Some("reviewer"));

        let status = ollama_status_params(Some("http://127.0.0.1:11434".into()));
        assert_eq!(status.base_url.as_deref(), Some("http://127.0.0.1:11434"));

        let ensure = ollama_ensure_params(
            Some("http://127.0.0.1:11434".into()),
            Some("llama3.2".into()),
        );
        assert_eq!(ensure.base_url.as_deref(), Some("http://127.0.0.1:11434"));
        assert_eq!(ensure.model_id.as_deref(), Some("llama3.2"));
    }

    #[test]
    fn local_coding_submit_enrichment_is_disabled_without_workspace() {
        let params = SubmitRunParams {
            prompt: "create a file".into(),
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            computer_use_target: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
            private_chat: false,
            research_workflow: None,
        };

        let enriched = enrich_local_coding_submit_params(params, None);

        assert_eq!(enriched.prompt, "create a file");
        assert!(enriched.client_mcp_tools.is_empty());
    }

    #[test]
    fn local_coding_submit_enrichment_adds_contract_and_tools() {
        let params = SubmitRunParams {
            prompt: "create a file".into(),
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            computer_use_target: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: vec![ClientMcpTool {
                server_name: crate::local_coding::WORKSPACE_MCP_SERVER_NAME.to_string(),
                tool_name: "read_file".to_string(),
                title: Some("Read file".to_string()),
                description: Some("existing".to_string()),
            }],
            private_chat: false,
            research_workflow: None,
        };

        let enriched =
            enrich_local_coding_submit_params(params, Some(std::path::PathBuf::from("/tmp/demo")));

        assert!(enriched.prompt.contains("TaskForceAI Code mode"));
        assert!(enriched.prompt.contains(
            "User request:
create a file"
        ));
        assert_eq!(
            enriched
                .client_mcp_tools
                .iter()
                .filter(|tool| tool.server_name == "workspace" && tool.tool_name == "read_file")
                .count(),
            1
        );
        assert!(enriched
            .client_mcp_tools
            .iter()
            .any(|tool| tool.server_name == "workspace" && tool.tool_name == "write_file"));
        assert!(!enriched
            .client_mcp_tools
            .iter()
            .any(|tool| tool.server_name == "workspace-shell" && tool.tool_name == "bash"));
    }

    #[test]
    fn local_coding_agent_session_run_enrichment_uses_fallback_prompt() {
        let params = AgentSessionRunParams {
            session_id: "agent-1".into(),
            prompt: None,
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: Vec::new(),
            permission_profile: None,
        };

        let enriched = enrich_local_coding_agent_session_run_params(
            params,
            &[std::path::PathBuf::from("/tmp/session-workspace")],
            Some("Fix the failing test".to_string()),
        );

        let prompt = enriched
            .prompt
            .expect("prompt should be filled from fallback");
        assert!(prompt.contains("working-directory roots:"));
        assert!(prompt.contains("- `/tmp/session-workspace`"));
        assert!(prompt.contains(
            "User request:
Fix the failing test"
        ));
        assert!(enriched
            .client_mcp_tools
            .iter()
            .any(|tool| tool.server_name == "workspace" && tool.tool_name == "edit_file"));
    }

    #[test]
    fn local_coding_turn_start_enrichment_prefixes_input_and_dedupes_tools() {
        let params = TurnStartParams {
            thread_id: "thread-1".into(),
            input: "Update docs".into(),
            display_input: None,
            model_id: None,
            reasoning_effort: None,
            quick_mode: None,
            autonomous: None,
            computer_use: None,
            use_logged_in_services: None,
            agent_count: None,
            project_id: None,
            workspace_root: None,
            attachment_ids: Vec::new(),
            client_mcp_tools: vec![ClientMcpTool {
                server_name: "workspace".to_string(),
                tool_name: "read_file".to_string(),
                title: Some("Read file".to_string()),
                description: None,
            }],
            client_user_message_id: None,
            permission_profile: None,
        };

        let enriched = enrich_local_coding_turn_start_params(
            params,
            &[std::path::PathBuf::from("/tmp/thread")],
        );

        assert!(enriched.input.contains("working-directory roots:"));
        assert_eq!(enriched.display_input.as_deref(), Some("Update docs"));
        assert!(enriched.input.contains("- `/tmp/thread`"));
        assert!(enriched.input.contains(
            "User request:
Update docs"
        ));
        assert_eq!(
            enriched
                .client_mcp_tools
                .iter()
                .filter(|tool| tool.server_name == "workspace" && tool.tool_name == "read_file")
                .count(),
            1
        );
        assert!(enriched
            .client_mcp_tools
            .iter()
            .any(|tool| tool.server_name == "workspace" && tool.tool_name == "write_file"));
    }
}
