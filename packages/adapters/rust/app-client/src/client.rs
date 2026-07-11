use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use taskforceai_app_protocol::{
    ActiveProjectResult, AgentSessionCreateParams, AgentSessionIDParams, AgentSessionListResult,
    AgentSessionMessageParams, AgentSessionResult, AgentSessionRunParams, AgentSessionRunResult,
    ApiHealthResult, AppServerEvent, AttachmentAddParams, AttachmentAddResult,
    AttachmentListResult, AuthStatus, BrowserStatusResult, ChannelAddParams, ChannelIDParams,
    ChannelListResult, ChannelPushParams, ChannelResult, CommandExecuteParams,
    CommandExecuteResult, ComputerUseStatusResult, ContextSummaryResult, ConversationIDParams,
    ConversationListParams, ConversationListResult, ConversationRecord,
    ConversationReplaceIDParams, ConversationResult, DesktopSyncPullParams, DesktopSyncPullResult,
    DesktopSyncPushParams, DesktopSyncPushResult, DeviceLoginPollParams, DeviceLoginPollResult,
    DeviceLoginStartResult, DiagnosticsInspectResult, GitReviewDiffParams, GitReviewDiffResult,
    GitReviewStatusParams, GitReviewStatusResult, GoalGetResult, GoalSetParams, HistoryListParams,
    HistoryListResult, HybridModeResult, HybridModeSetParams, InitializeResult, JsonRpcError,
    JsonRpcResponse, LocalSettingsResult, LocalSettingsUpdateParams, McpAvailableResult,
    McpInspectResult, McpServerAddParams, McpServerListResult, McpServerParams, McpServerResult,
    McpServerToolsParams, McpToolCallParams, McpToolCallResult, MemorySummaryResult,
    MessageIDParams, MessageListResult, MessageRecord, MessageResult, MetadataGetParams,
    MetadataGetResult, MetadataSetParams, ModelListResult, ModelSelectParams, OllamaEnsureParams,
    OllamaEnsureResult, OllamaStatusParams, OllamaStatusResult, OrchestrationBudgetSetParams,
    OrchestrationConfigResult, OrchestrationRoleSetParams, PendingChangeIDParams,
    PendingChangeListResult, PendingChangeRecord, PendingChangeResult,
    PendingChangeUpdateDataParams, PendingPromptIDParams, PendingPromptListResult,
    PendingPromptRecord, PendingPromptReplayResult, PendingPromptResult, PetResult, PetSetParams,
    PluginListResult, PluginSetEnabledParams, ProjectCreateParams, ProjectIDParams,
    ProjectListResult, ProjectResult, PromptQueueDispatchAfterResponseParams,
    PromptQueueDispatchResult, PromptQueueIDParams, PromptQueueListResult, PromptQueueRecord,
    PromptQueueResult, QuickModeResult, QuickModeSetParams, RemoteSettingsCommandParams,
    RunIDParams, RunModeSetParams, RunSearchParams, RunSearchResult, RunStatusResult,
    ScheduleAddParams, ScheduleIDParams, ScheduleListResult, ScheduleResult, ScheduleTickParams,
    ScheduleTickResult, SkillListResult, StatusSummaryResult, SubmitRunParams, SubmitRunResult,
    SyncConfigureParams, SyncDeviceResult, SyncPullParams, SyncPullResult, SyncPushParams,
    SyncPushResult, SyncRealtimePollParams, SyncRealtimePollResult, SyncStatusResult,
    ThreadIDParams, ThreadListResult, ThreadResult, ThreadStartParams, TurnInterruptParams,
    TurnResult, TurnStartParams, TurnSteerParams, UsageSummaryResult, VoiceRealtimeSetupParams,
    VoiceRealtimeSetupResult, VoiceSpeechGenerateParams, VoiceSpeechGenerateResult,
    VoiceTranscribeParams, VoiceTranscribeResult, WorkflowIDParams, WorkflowListResult,
    WorkflowResult, WorkflowRunIDParams, WorkflowRunListResult, WorkflowRunParams,
    WorkflowRunResult, WorkflowSaveParams, JSONRPC_VERSION,
};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

use crate::error::AppClientError;
use crate::transport::{
    read_http_events, read_loop, AppServerEventMessage, AppServerTransport, EventReceiver,
    PendingResponses, EVENT_CHANNEL_CAPACITY,
};

#[cfg(test)]
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
#[cfg(not(test))]
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(test)]
pub(crate) const RUN_SUBMIT_TIMEOUT: Duration = Duration::from_millis(1500);
#[cfg(not(test))]
pub(crate) const RUN_SUBMIT_TIMEOUT: Duration = Duration::from_secs(180);

pub struct AppServerClient {
    pub(crate) transport: AppServerTransport,
    next_id: Arc<AtomicU64>,
}

#[derive(Debug, Clone, Default)]
pub struct AppServerSpawnOptions {
    pub run_store_path: Option<PathBuf>,
    pub api_base_url: Option<String>,
    pub inherit_stderr: bool,
}

#[derive(Clone)]
pub struct AppServerRequestHandle {
    transport: AppServerRequestTransport,
    next_id: Arc<AtomicU64>,
}

#[derive(Clone)]
enum AppServerRequestTransport {
    Stdio {
        stdin: Arc<Mutex<tokio::process::ChildStdin>>,
        pending_responses: PendingResponses,
    },
    Http {
        base_url: String,
        session_token: String,
        client: reqwest::Client,
    },
}

macro_rules! client_method {
    ($name:ident, $method:literal, $result:ty) => {
        pub async fn $name(&self) -> Result<$result, AppClientError> {
            self.request($method, json!({})).await
        }
    };
    ($name:ident, $method:literal, $params:ty => $result:ty) => {
        pub async fn $name(&self, params: $params) -> Result<$result, AppClientError> {
            self.request($method, params).await
        }
    };
}

macro_rules! app_server_methods {
    () => {
        client_method!(initialize, "initialize", InitializeResult);
        client_method!(history_list, "history.list", HistoryListParams => HistoryListResult);
        client_method!(usage_summary, "usage.summary", UsageSummaryResult);
        client_method!(status_summary, "status.summary", StatusSummaryResult);
        client_method!(pet_get, "pet.get", PetResult);
        client_method!(pet_set, "pet.set", PetSetParams => PetResult);
        client_method!(conversation_list, "conversation.list", ConversationListParams => ConversationListResult);
        client_method!(conversation_get, "conversation.get", ConversationIDParams => ConversationResult);
        client_method!(conversation_upsert, "conversation.upsert", ConversationRecord => ConversationResult);
        client_method!(conversation_delete, "conversation.delete", ConversationIDParams => Value);
        client_method!(conversation_delete_all, "conversation.deleteAll", Value);
        client_method!(conversation_replace_id, "conversation.replaceId", ConversationReplaceIDParams => Value);
        client_method!(message_list, "message.list", ConversationIDParams => MessageListResult);
        client_method!(message_get, "message.get", MessageIDParams => MessageResult);
        client_method!(message_upsert, "message.upsert", MessageRecord => MessageResult);
        client_method!(message_delete, "message.delete", MessageIDParams => Value);
        client_method!(
            pending_change_list,
            "pendingChange.list",
            PendingChangeListResult
        );
        client_method!(pending_change_add, "pendingChange.add", PendingChangeRecord => PendingChangeResult);
        client_method!(pending_change_update_data, "pendingChange.updateData", PendingChangeUpdateDataParams => Value);
        client_method!(pending_change_delete, "pendingChange.delete", PendingChangeIDParams => Value);
        client_method!(pending_change_clear, "pendingChange.clear", Value);
        client_method!(prompt_queue_list, "promptQueue.list", PromptQueueListResult);
        client_method!(prompt_queue_add, "promptQueue.add", PromptQueueRecord => PromptQueueResult);
        client_method!(prompt_queue_delete, "promptQueue.delete", PromptQueueIDParams => Value);
        client_method!(prompt_queue_clear, "promptQueue.clear", Value);
        client_method!(prompt_queue_dispatch_after_response, "promptQueue.dispatchAfterResponse", PromptQueueDispatchAfterResponseParams => PromptQueueDispatchResult);
        client_method!(metadata_get, "metadata.get", MetadataGetParams => MetadataGetResult);
        client_method!(metadata_set, "metadata.set", MetadataSetParams => Value);
        client_method!(metadata_clear_all, "metadata.clearAll", Value);
        client_method!(sync_status, "sync.status", SyncStatusResult);
        client_method!(sync_configure, "sync.configure", SyncConfigureParams => SyncStatusResult);
        client_method!(sync_ensure_device, "sync.ensureDevice", SyncDeviceResult);
        client_method!(sync_pull, "sync.pull", SyncPullParams => SyncPullResult);
        client_method!(sync_push, "sync.push", SyncPushParams => SyncPushResult);
        client_method!(desktop_sync_pull, "desktopSync.pull", DesktopSyncPullParams => DesktopSyncPullResult);
        client_method!(desktop_sync_push, "desktopSync.push", DesktopSyncPushParams => DesktopSyncPushResult);
        client_method!(sync_realtime_poll, "sync.realtimePoll", SyncRealtimePollParams => SyncRealtimePollResult);
        client_method!(sync_run, "sync.run", SyncRealtimePollParams => SyncRealtimePollResult);
        client_method!(voice_transcribe, "voice.transcribe", VoiceTranscribeParams => VoiceTranscribeResult);
        client_method!(voice_speech_generate, "voice.speechGenerate", VoiceSpeechGenerateParams => VoiceSpeechGenerateResult);
        client_method!(voice_realtime_setup, "voice.realtimeSetup", VoiceRealtimeSetupParams => VoiceRealtimeSetupResult);
        client_method!(api_health, "api.health", ApiHealthResult);
        client_method!(
            auth_device_start,
            "auth.deviceStart",
            DeviceLoginStartResult
        );
        client_method!(auth_device_poll, "auth.devicePoll", DeviceLoginPollParams => DeviceLoginPollResult);
        client_method!(auth_status, "auth.status", AuthStatus);
        client_method!(auth_logout, "auth.logout", AuthStatus);
        client_method!(run_submit, "run.submit", SubmitRunParams => SubmitRunResult);
        client_method!(run_status, "run.status", RunIDParams => RunStatusResult);
        client_method!(run_search, "run.search", RunSearchParams => RunSearchResult);
        client_method!(run_cancel, "run.cancel", RunIDParams => RunStatusResult);
        client_method!(run_delete, "run.delete", RunIDParams => Value);
        client_method!(
            pending_prompt_list,
            "pendingPrompt.list",
            PendingPromptListResult
        );
        client_method!(pending_prompt_add, "pendingPrompt.add", PendingPromptRecord => PendingPromptResult);
        client_method!(pending_prompt_delete, "pendingPrompt.delete", PendingPromptIDParams => Value);
        client_method!(
            pending_prompt_replay,
            "pendingPrompt.replay",
            PendingPromptReplayResult
        );
        client_method!(project_list, "project.list", ProjectListResult);
        client_method!(project_create, "project.create", ProjectCreateParams => ProjectResult);
        client_method!(project_delete, "project.delete", ProjectIDParams => Value);
        client_method!(project_use, "project.use", ProjectIDParams => ActiveProjectResult);
        client_method!(project_clear, "project.clear", ActiveProjectResult);
        client_method!(command_execute, "command.execute", CommandExecuteParams => CommandExecuteResult);
        client_method!(quick_mode_get, "quickMode.get", QuickModeResult);
        client_method!(quick_mode_set, "quickMode.set", QuickModeSetParams => QuickModeResult);
        client_method!(autonomous_mode_get, "autonomousMode.get", QuickModeResult);
        client_method!(autonomous_mode_set, "autonomousMode.set", RunModeSetParams => QuickModeResult);
        client_method!(
            computer_use_mode_get,
            "computerUseMode.get",
            QuickModeResult
        );
        client_method!(computer_use_mode_set, "computerUseMode.set", RunModeSetParams => QuickModeResult);
        client_method!(goal_get, "goal.get", GoalGetResult);
        client_method!(goal_set, "goal.set", GoalSetParams => GoalGetResult);
        client_method!(goal_pause, "goal.pause", GoalGetResult);
        client_method!(goal_resume, "goal.resume", GoalGetResult);
        client_method!(goal_clear, "goal.clear", Value);
        client_method!(git_review_status, "git.review.status", GitReviewStatusParams => GitReviewStatusResult);
        client_method!(git_review_diff, "git.review.diff", GitReviewDiffParams => GitReviewDiffResult);
        client_method!(
            agent_session_list,
            "agentSession.list",
            AgentSessionListResult
        );
        client_method!(agent_session_create, "agentSession.create", AgentSessionCreateParams => AgentSessionResult);
        client_method!(agent_session_get, "agentSession.get", AgentSessionIDParams => AgentSessionResult);
        client_method!(agent_session_pause, "agentSession.pause", AgentSessionIDParams => AgentSessionResult);
        client_method!(agent_session_resume, "agentSession.resume", AgentSessionIDParams => AgentSessionResult);
        client_method!(agent_session_cancel, "agentSession.cancel", AgentSessionIDParams => AgentSessionResult);
        client_method!(agent_session_message, "agentSession.message", AgentSessionMessageParams => AgentSessionResult);
        client_method!(agent_session_fork, "agentSession.fork", AgentSessionIDParams => AgentSessionResult);
        client_method!(agent_session_run, "agentSession.run", AgentSessionRunParams => AgentSessionRunResult);
        client_method!(thread_list, "thread/list", ThreadListResult);
        client_method!(thread_start, "thread/start", ThreadStartParams => ThreadResult);
        client_method!(thread_resume, "thread/resume", ThreadIDParams => ThreadResult);
        client_method!(thread_archive, "thread/archive", ThreadIDParams => ThreadResult);
        client_method!(thread_fork, "thread/fork", ThreadIDParams => ThreadResult);
        client_method!(turn_start, "turn/start", TurnStartParams => TurnResult);
        client_method!(turn_steer, "turn/steer", TurnSteerParams => ThreadResult);
        client_method!(turn_interrupt, "turn/interrupt", TurnInterruptParams => TurnResult);
        client_method!(
            diagnostics_inspect,
            "diagnostics.inspect",
            DiagnosticsInspectResult
        );
        client_method!(channel_list, "channel.list", ChannelListResult);
        client_method!(channel_add, "channel.add", ChannelAddParams => ChannelResult);
        client_method!(channel_delete, "channel.delete", ChannelIDParams => Value);
        client_method!(channel_push, "channel.push", ChannelPushParams => ChannelResult);
        client_method!(schedule_list, "schedule.list", ScheduleListResult);
        client_method!(schedule_add, "schedule.add", ScheduleAddParams => ScheduleResult);
        client_method!(schedule_delete, "schedule.delete", ScheduleIDParams => Value);
        client_method!(schedule_enable, "schedule.enable", ScheduleIDParams => ScheduleResult);
        client_method!(schedule_disable, "schedule.disable", ScheduleIDParams => ScheduleResult);
        client_method!(schedule_tick, "schedule.tick", ScheduleTickParams => ScheduleTickResult);
        client_method!(workflow_list, "workflow.list", WorkflowListResult);
        client_method!(workflow_save, "workflow.save", WorkflowSaveParams => WorkflowResult);
        client_method!(workflow_get, "workflow.get", WorkflowIDParams => WorkflowResult);
        client_method!(workflow_delete, "workflow.delete", WorkflowIDParams => Value);
        client_method!(workflow_run, "workflow.run", WorkflowRunParams => WorkflowRunResult);
        client_method!(workflow_run_list, "workflowRun.list", WorkflowRunListResult);
        client_method!(workflow_run_get, "workflowRun.get", WorkflowRunIDParams => WorkflowRunResult);
        client_method!(workflow_run_pause, "workflowRun.pause", WorkflowRunIDParams => WorkflowRunResult);
        client_method!(workflow_run_resume, "workflowRun.resume", WorkflowRunIDParams => WorkflowRunResult);
        client_method!(workflow_run_cancel, "workflowRun.cancel", WorkflowRunIDParams => WorkflowRunResult);
        client_method!(
            orchestration_get,
            "orchestration.get",
            OrchestrationConfigResult
        );
        client_method!(orchestration_set_role, "orchestration.setRole", OrchestrationRoleSetParams => OrchestrationConfigResult);
        client_method!(orchestration_set_budget, "orchestration.setBudget", OrchestrationBudgetSetParams => OrchestrationConfigResult);
        client_method!(
            orchestration_clear,
            "orchestration.clear",
            OrchestrationConfigResult
        );
        client_method!(hybrid_mode_get, "hybridMode.get", HybridModeResult);
        client_method!(hybrid_mode_set, "hybridMode.set", HybridModeSetParams => HybridModeResult);
        client_method!(
            local_settings_get,
            "settings.local.get",
            LocalSettingsResult
        );
        client_method!(local_settings_update, "settings.local.update", LocalSettingsUpdateParams => LocalSettingsResult);
        client_method!(remote_settings_command, "settings.remote.command", RemoteSettingsCommandParams => CommandExecuteResult);
        client_method!(model_list, "model.list", ModelListResult);
        client_method!(model_select, "model.select", ModelSelectParams => ModelListResult);
        client_method!(model_reset, "model.reset", ModelListResult);
        client_method!(ollama_status, "ollama.status", OllamaStatusParams => OllamaStatusResult);
        client_method!(ollama_ensure, "ollama.ensure", OllamaEnsureParams => OllamaEnsureResult);
        client_method!(skill_list, "skill.list", SkillListResult);
        client_method!(plugin_list, "plugin.list", PluginListResult);
        client_method!(plugin_set_enabled, "plugin.setEnabled", PluginSetEnabledParams => PluginListResult);
        client_method!(
            computer_use_status,
            "computerUse.status",
            ComputerUseStatusResult
        );
        client_method!(browser_status, "browser.status", BrowserStatusResult);
        client_method!(context_summary, "context.summary", ContextSummaryResult);
        client_method!(memory_summary, "memory.summary", MemorySummaryResult);
        client_method!(attachment_list, "attachment.list", AttachmentListResult);
        client_method!(attachment_add, "attachment.add", AttachmentAddParams => AttachmentAddResult);
        client_method!(attachment_clear, "attachment.clear", AttachmentListResult);
        client_method!(mcp_list, "mcp.list", McpServerListResult);
        client_method!(mcp_add, "mcp.add", McpServerAddParams => McpServerResult);
        client_method!(mcp_remove, "mcp.remove", McpServerParams => Value);
        client_method!(mcp_enable, "mcp.enable", McpServerParams => McpServerResult);
        client_method!(mcp_disable, "mcp.disable", McpServerParams => McpServerResult);
        client_method!(mcp_tools, "mcp.tools", McpServerToolsParams => McpServerResult);
        client_method!(mcp_available, "mcp.available", McpAvailableResult);
        client_method!(mcp_inspect, "mcp.inspect", McpServerParams => McpInspectResult);
        client_method!(mcp_call_tool, "mcp.callTool", McpToolCallParams => McpToolCallResult);
    };
}

impl AppServerClient {
    pub async fn spawn(binary_path: impl AsRef<Path>) -> Result<Self, AppClientError> {
        Self::spawn_with_options(binary_path, AppServerSpawnOptions::default()).await
    }

    pub async fn spawn_with_options(
        binary_path: impl AsRef<Path>,
        options: AppServerSpawnOptions,
    ) -> Result<Self, AppClientError> {
        let mut command = Command::new(binary_path.as_ref());
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(if options.inherit_stderr {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .kill_on_drop(true);
        if let Some(path) = options.run_store_path {
            command.env("TASKFORCE_APP_SERVER_RUN_STORE", path);
        }
        if let Some(base_url) = options.api_base_url {
            command.env("TASKFORCE_APP_SERVER_API_BASE_URL", base_url);
        }

        let mut child = command.spawn().map_err(AppClientError::Spawn)?;

        let stdin = child.stdin.take().ok_or(AppClientError::MissingStdin)?;
        let stdout = child.stdout.take().ok_or(AppClientError::MissingStdout)?;
        let pending_responses = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);

        tokio::spawn(read_loop(stdout, Arc::clone(&pending_responses), event_tx));

        Ok(Self {
            transport: AppServerTransport::Stdio {
                child,
                stdin: Arc::new(Mutex::new(stdin)),
                pending_responses,
                events: event_rx,
            },
            next_id: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn connect_http(
        base_url: impl Into<String>,
        session_token: impl Into<String>,
    ) -> Result<Self, AppClientError> {
        let session_token = session_token.into();
        let mut headers = HeaderMap::new();
        let mut bearer = HeaderValue::from_str(&format!("Bearer {session_token}"))
            .map_err(|_| AppClientError::InvalidAuthToken)?;
        bearer.set_sensitive(true);
        headers.insert(AUTHORIZATION, bearer);
        let client = reqwest::Client::builder()
            .default_headers(headers.clone())
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        let event_client = reqwest::Client::builder()
            .default_headers(headers)
            .connect_timeout(REQUEST_TIMEOUT)
            .build()?;
        let base_url = base_url.into().trim_end_matches('/').to_string();

        Ok(Self {
            transport: AppServerTransport::Http {
                base_url,
                session_token,
                client,
                event_client,
                events: None,
                event_task: None,
            },
            next_id: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn request_handle(&self) -> AppServerRequestHandle {
        let transport = match &self.transport {
            AppServerTransport::Stdio {
                stdin,
                pending_responses,
                ..
            } => AppServerRequestTransport::Stdio {
                stdin: Arc::clone(stdin),
                pending_responses: Arc::clone(pending_responses),
            },
            AppServerTransport::Http {
                base_url,
                session_token,
                client,
                ..
            } => AppServerRequestTransport::Http {
                base_url: base_url.clone(),
                session_token: session_token.clone(),
                client: client.clone(),
            },
        };
        AppServerRequestHandle {
            transport,
            next_id: Arc::clone(&self.next_id),
        }
    }

    app_server_methods!();

    pub async fn next_event(&mut self) -> Result<Option<AppServerEvent>, AppClientError> {
        match &mut self.transport {
            AppServerTransport::Stdio { events, .. } => receive_event(events).await,
            AppServerTransport::Http {
                base_url,
                session_token,
                event_client,
                events,
                event_task,
                ..
            } => {
                receive_http_event(base_url, session_token, event_client, events, event_task).await
            }
        }
    }

    pub async fn shutdown(mut self) -> Result<(), AppClientError> {
        let _: Value = self.request("shutdown", json!({})).await?;
        if let AppServerTransport::Stdio { child, .. } = &mut self.transport {
            let _status = child.wait().await.map_err(AppClientError::Read)?;
        }
        Ok(())
    }

    pub async fn kill(&mut self) {
        if let AppServerTransport::Stdio { child, .. } = &mut self.transport {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn request<T, P>(&self, method: &str, params: P) -> Result<T, AppClientError>
    where
        T: DeserializeOwned,
        P: Serialize,
    {
        self.request_handle().request(method, params).await
    }
}

impl AppServerRequestHandle {
    app_server_methods!();

    async fn request<T, P>(&self, method: &str, params: P) -> Result<T, AppClientError>
    where
        T: DeserializeOwned,
        P: Serialize,
    {
        let id = self.next_request_id();
        match &self.transport {
            AppServerRequestTransport::Stdio {
                stdin,
                pending_responses,
            } => request_stdio(stdin, pending_responses, id, method, &params).await,
            AppServerRequestTransport::Http {
                base_url,
                session_token,
                client,
            } => {
                let message = JsonRpcRequestMessage {
                    jsonrpc: JSONRPC_VERSION,
                    id,
                    method,
                    params,
                };
                let response = client
                    .post(format!("{base_url}/rpc"))
                    .header("X-Taskforce-Session", session_token.as_str())
                    .timeout(request_timeout_for_method(method))
                    .json(&message)
                    .send()
                    .await?
                    .error_for_status()?
                    .json::<JsonRpcResponse>()
                    .await?;
                decode_response(response)
            }
        }
    }

    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}

#[derive(Serialize)]
struct JsonRpcRequestMessage<'a, P> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: P,
}

pub(crate) fn encode_stdio_request<P>(
    id: u64,
    method: &str,
    params: &P,
) -> Result<Vec<u8>, AppClientError>
where
    P: Serialize,
{
    let message = JsonRpcRequestMessage {
        jsonrpc: JSONRPC_VERSION,
        id,
        method,
        params,
    };
    let mut line = serde_json::to_vec(&message).map_err(AppClientError::Encode)?;
    line.push(b'\n');
    Ok(line)
}

async fn request_stdio<T>(
    stdin: &Arc<Mutex<tokio::process::ChildStdin>>,
    pending_responses: &PendingResponses,
    id: u64,
    method: &str,
    params: &impl Serialize,
) -> Result<T, AppClientError>
where
    T: DeserializeOwned,
{
    let line = encode_stdio_request(id, method, params)?;
    let (response_tx, response_rx) = oneshot::channel();
    pending_responses.lock().await.insert(id, response_tx);

    let request_timeout = request_timeout_for_method(method);
    let result = timeout(request_timeout, async {
        {
            let mut stdin = stdin.lock().await;
            stdin
                .write_all(&line)
                .await
                .map_err(AppClientError::Write)?;
            stdin.flush().await.map_err(AppClientError::Write)?;
        }

        let response = response_rx.await.map_err(|_| AppClientError::Closed)?;
        decode_response(response)
    })
    .await;

    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => {
            pending_responses.lock().await.remove(&id);
            Err(error)
        }
        Err(_) => {
            pending_responses.lock().await.remove(&id);
            Err(request_timeout_error(method, request_timeout))
        }
    }
}

pub(crate) fn request_timeout_for_method(method: &str) -> Duration {
    if method == "run.submit" {
        RUN_SUBMIT_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    }
}

impl Drop for AppServerClient {
    fn drop(&mut self) {
        if let AppServerTransport::Http {
            event_task: Some(event_task),
            ..
        } = &mut self.transport
        {
            event_task.abort();
        }
    }
}

pub(crate) fn request_timeout_error(method: &str, request_timeout: Duration) -> AppClientError {
    AppClientError::RequestTimeout {
        method: method.to_owned(),
        timeout_ms: request_timeout.as_millis() as u64,
    }
}

async fn receive_http_event(
    base_url: &str,
    session_token: &str,
    event_client: &reqwest::Client,
    events: &mut Option<EventReceiver>,
    event_task: &mut Option<JoinHandle<()>>,
) -> Result<Option<AppServerEvent>, AppClientError> {
    if events.is_none() {
        let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        *event_task = Some(tokio::spawn(read_http_events(
            base_url.to_string(),
            session_token.to_string(),
            event_client.clone(),
            event_tx,
        )));
        *events = Some(event_rx);
    }

    let event = receive_event(events.as_mut().ok_or(AppClientError::Closed)?).await?;
    if event.is_none() {
        *events = None;
        *event_task = None;
    }
    Ok(event)
}

pub(crate) async fn receive_event(
    events: &mut EventReceiver,
) -> Result<Option<AppServerEvent>, AppClientError> {
    match events.recv().await {
        Ok(AppServerEventMessage::Event(event)) => Ok(Some(event)),
        Ok(AppServerEventMessage::StreamError { message }) => {
            Err(AppClientError::EventStream { message })
        }
        Err(broadcast::error::RecvError::Closed) => Ok(None),
        Err(broadcast::error::RecvError::Lagged(count)) => {
            Err(AppClientError::EventsDropped { count })
        }
    }
}

pub(crate) fn decode_response<T>(response: JsonRpcResponse) -> Result<T, AppClientError>
where
    T: DeserializeOwned,
{
    if let Some(error) = response.error {
        return Err(rpc_error(error));
    }
    let result = response.result.ok_or(AppClientError::MissingResult)?;
    serde_json::from_value(result).map_err(AppClientError::Decode)
}

fn rpc_error(error: JsonRpcError) -> AppClientError {
    AppClientError::Rpc {
        code: error.code,
        message: error.message,
    }
}
