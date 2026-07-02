'use client';

import { invokeTauri } from './bridge';
import type {
  AppServerStatusSummary,
  AppServerAuthStatus,
  AppServerCommandExecuteParams,
  AppServerCommandExecuteResult,
  AppServerDeviceLoginStart,
  AppServerDeviceLoginPoll,
  AppServerHistoryListResult,
  AppServerSubmitRunParams,
  AppServerSubmitRunResult,
  AppServerEnableLocalCodingParams,
  AppServerEnableLocalCodingResult,
  AppServerPetSetParams,
  AppServerPetResult,
  AppServerAgentSessionCreateParams,
  AppServerAgentSessionListResult,
  AppServerAgentSessionMessageParams,
  AppServerAgentSessionResult,
  AppServerAgentSessionRunParams,
  AppServerAgentSessionRunResult,
  AppServerThreadListResult,
  AppServerThreadResult,
  AppServerThreadStartParams,
  AppServerTurnInterruptParams,
  AppServerTurnResult,
  AppServerTurnStartParams,
  AppServerTurnSteerParams,
  AppServerDiagnosticsInspectResult,
  AppServerChannelAddParams,
  AppServerChannelListResult,
  AppServerChannelPushParams,
  AppServerChannelResult,
  AppServerScheduleAddParams,
  AppServerScheduleListResult,
  AppServerScheduleResult,
  AppServerScheduleTickParams,
  AppServerScheduleTickResult,
  AppServerRunStatusResult,
  AppServerPendingChange,
  AppServerPendingChangeListResult,
  AppServerSyncStatus,
  AppServerSyncDevice,
  AppServerModeResult,
  AppServerHybridModeResult,
  AppServerHybridModeSetParams,
  AppServerLocalSettingsUpdate,
  AppServerLocalSettingsResult,
  AppServerModelListResult,
  AppServerSkillListResult,
  AppServerPluginListResult,
  AppServerComputerUseStatus,
  AppServerBrowserStatus,
  AppServerContextSummary,
  AppServerMemorySummary,
  AppServerOllamaStatus,
  AppServerOllamaEnsureResult,
  AppServerHttpPairingInfo,
  AppServerEnvironmentStatus,
  AppServerSshConnectParams,
  AppServerSshConnectResult,
  AppServerSshProbeParams,
  AppServerSshProbeResult,
  DesktopScreenMemoryStatus,
  AppServerVoiceRealtimeSetupParams,
  AppServerVoiceRealtimeSetupResult,
  AppServerVoiceSpeechGenerateParams,
  AppServerVoiceSpeechGenerateResult,
  AppServerVoiceTranscribeParams,
  AppServerVoiceTranscribeResult,
  DesktopWorkspaceFileTreeParams,
  DesktopWorkspaceFileTreeResult,
  DesktopWorkspaceFileReadParams,
  DesktopWorkspaceFileReadResult,
} from './app-server-types';
export type * from './app-server-types';

const invokeWithParams = <T>(command: string, params: unknown) =>
  invokeTauri<T>(command, { params });
const invokeWithArg = <T>(command: string, key: string, value: unknown) =>
  invokeTauri<T>(command, { [key]: value });

export const initializeDesktopAppServer = () => invokeTauri('app_server_initialize');

export const getDesktopAppServerHttpPairingInfo = () =>
  invokeTauri<AppServerHttpPairingInfo>('app_server_http_pairing_info');

export const getDesktopAppServerEnvironmentStatus = () =>
  invokeTauri<AppServerEnvironmentStatus>('app_server_environment_status');

export const useLocalDesktopAppServerEnvironment = () =>
  invokeTauri<AppServerEnvironmentStatus>('app_server_environment_use_local');

export const disconnectRemoteDesktopAppServerEnvironment = () =>
  invokeTauri<AppServerEnvironmentStatus>('app_server_environment_disconnect_remote');

export const probeDesktopAppServerSshTarget = (params: AppServerSshProbeParams) =>
  invokeWithParams<AppServerSshProbeResult>('app_server_ssh_probe', params);

export const connectDesktopAppServerSshTarget = (params: AppServerSshConnectParams) =>
  invokeWithParams<AppServerSshConnectResult>('app_server_ssh_connect', params);

export const getDesktopAppServerStatus = () =>
  invokeTauri<AppServerStatusSummary>('app_server_status_summary');

export const getDesktopAppServerPet = () => invokeTauri<AppServerPetResult>('app_server_pet_get');

export const setDesktopAppServerPet = (params: AppServerPetSetParams) =>
  invokeWithParams<AppServerPetResult>('app_server_pet_set', params);

export const executeDesktopAppServerCommand = (params: AppServerCommandExecuteParams) =>
  invokeWithParams<AppServerCommandExecuteResult>('app_server_command_execute', params);

export const listDesktopAppServerAgentSessions = () =>
  invokeTauri<AppServerAgentSessionListResult>('app_server_agent_session_list');

export const listDesktopAppServerThreads = () =>
  invokeTauri<AppServerThreadListResult>('app_server_thread_list');

export const createDesktopAppServerAgentSession = (params: AppServerAgentSessionCreateParams) =>
  invokeWithParams<AppServerAgentSessionResult>('app_server_agent_session_create', params);

export const startDesktopAppServerThread = (params: AppServerThreadStartParams) =>
  invokeWithParams<AppServerThreadResult>('app_server_thread_start', params);

export const resumeDesktopAppServerThread = (threadId: string) =>
  invokeWithArg<AppServerThreadResult>('app_server_thread_resume', 'threadId', threadId);

export const archiveDesktopAppServerThread = (threadId: string) =>
  invokeWithArg<AppServerThreadResult>('app_server_thread_archive', 'threadId', threadId);

export const forkDesktopAppServerThread = (threadId: string) =>
  invokeWithArg<AppServerThreadResult>('app_server_thread_fork', 'threadId', threadId);

export const startDesktopAppServerTurn = (params: AppServerTurnStartParams) =>
  invokeWithParams<AppServerTurnResult>('app_server_turn_start', params);

export const steerDesktopAppServerTurn = (params: AppServerTurnSteerParams) =>
  invokeWithParams<AppServerThreadResult>('app_server_turn_steer', params);

export const interruptDesktopAppServerTurn = (params: AppServerTurnInterruptParams) =>
  invokeWithParams<AppServerTurnResult>('app_server_turn_interrupt', params);

export const pauseDesktopAppServerAgentSession = (sessionId: string) =>
  invokeWithArg<AppServerAgentSessionResult>(
    'app_server_agent_session_pause',
    'sessionId',
    sessionId
  );

export const resumeDesktopAppServerAgentSession = (sessionId: string) =>
  invokeWithArg<AppServerAgentSessionResult>(
    'app_server_agent_session_resume',
    'sessionId',
    sessionId
  );

export const cancelDesktopAppServerAgentSession = (sessionId: string) =>
  invokeWithArg<AppServerAgentSessionResult>(
    'app_server_agent_session_cancel',
    'sessionId',
    sessionId
  );

export const messageDesktopAppServerAgentSession = (params: AppServerAgentSessionMessageParams) =>
  invokeWithParams<AppServerAgentSessionResult>('app_server_agent_session_message', params);

export const forkDesktopAppServerAgentSession = (sessionId: string) =>
  invokeWithArg<AppServerAgentSessionResult>(
    'app_server_agent_session_fork',
    'sessionId',
    sessionId
  );

export const runDesktopAppServerAgentSession = (params: AppServerAgentSessionRunParams) =>
  invokeWithParams<AppServerAgentSessionRunResult>('app_server_agent_session_run', params);

export const inspectDesktopAppServerDiagnostics = () =>
  invokeTauri<AppServerDiagnosticsInspectResult>('app_server_diagnostics_inspect');

export const listDesktopAppServerChannels = () =>
  invokeTauri<AppServerChannelListResult>('app_server_channel_list');

export const addDesktopAppServerChannel = (params: AppServerChannelAddParams) =>
  invokeWithParams<AppServerChannelResult>('app_server_channel_add', params);

export const deleteDesktopAppServerChannel = (channelId: string) =>
  invokeWithArg<void>('app_server_channel_delete', 'channelId', channelId);

export const pushDesktopAppServerChannel = (params: AppServerChannelPushParams) =>
  invokeWithParams<AppServerChannelResult>('app_server_channel_push', params);

export const listDesktopAppServerSchedules = () =>
  invokeTauri<AppServerScheduleListResult>('app_server_schedule_list');

export const addDesktopAppServerSchedule = (params: AppServerScheduleAddParams) =>
  invokeWithParams<AppServerScheduleResult>('app_server_schedule_add', params);

export const deleteDesktopAppServerSchedule = (scheduleId: string) =>
  invokeWithArg<void>('app_server_schedule_delete', 'scheduleId', scheduleId);

export const enableDesktopAppServerSchedule = (scheduleId: string) =>
  invokeWithArg<AppServerScheduleResult>('app_server_schedule_enable', 'scheduleId', scheduleId);

export const disableDesktopAppServerSchedule = (scheduleId: string) =>
  invokeWithArg<AppServerScheduleResult>('app_server_schedule_disable', 'scheduleId', scheduleId);

export const tickDesktopAppServerSchedules = (params: AppServerScheduleTickParams = {}) =>
  invokeWithParams<AppServerScheduleTickResult>('app_server_schedule_tick', params);

export const getDesktopAppServerAuthStatus = () =>
  invokeTauri<AppServerAuthStatus>('app_server_auth_status');

export const startDesktopAppServerDeviceLogin = () =>
  invokeTauri<AppServerDeviceLoginStart>('app_server_auth_device_start');

export const pollDesktopAppServerDeviceLogin = (deviceCode: string) =>
  invokeWithArg<AppServerDeviceLoginPoll>('app_server_auth_device_poll', 'deviceCode', deviceCode);

export const logoutDesktopAppServerAuth = () =>
  invokeTauri<AppServerAuthStatus>('app_server_auth_logout');

export const transcribeDesktopAppServerVoice = (params: AppServerVoiceTranscribeParams) =>
  invokeWithParams<AppServerVoiceTranscribeResult>('app_server_voice_transcribe', params);

export const generateDesktopAppServerVoiceSpeech = (params: AppServerVoiceSpeechGenerateParams) =>
  invokeWithParams<AppServerVoiceSpeechGenerateResult>('app_server_voice_speech_generate', params);

export const setupDesktopAppServerRealtimeVoice = (params: AppServerVoiceRealtimeSetupParams) =>
  invokeWithParams<AppServerVoiceRealtimeSetupResult>('app_server_voice_realtime_setup', params);

export const openDesktopExternalUrl = (url: string) =>
  invokeTauri<void>('open_external_url', { url });

export const getDesktopWorkspaceFileTree = (params: DesktopWorkspaceFileTreeParams = {}) =>
  invokeTauri<DesktopWorkspaceFileTreeResult>('workspace_file_tree', { params });

export const readDesktopWorkspaceFile = (params: DesktopWorkspaceFileReadParams) =>
  invokeTauri<DesktopWorkspaceFileReadResult>('workspace_file_read', { params });

export const listDesktopAppServerHistory = (limit?: number) =>
  invokeTauri<AppServerHistoryListResult>('app_server_history_list', { limit });

export const submitDesktopAppServerRun = (params: AppServerSubmitRunParams) =>
  invokeWithParams<AppServerSubmitRunResult>('app_server_submit_run', params);

export const enableDesktopLocalCoding = (params: AppServerEnableLocalCodingParams = {}) =>
  invokeTauri<AppServerEnableLocalCodingResult>('app_server_enable_local_coding', { params });

export const getDesktopAppServerRunStatus = (runId: string) =>
  invokeWithArg<AppServerRunStatusResult>('app_server_run_status', 'runId', runId);

export const cancelDesktopAppServerRun = (runId: string) =>
  invokeWithArg<AppServerRunStatusResult>('app_server_cancel_run', 'runId', runId);

export const listDesktopAppServerPendingChanges = () =>
  invokeTauri<AppServerPendingChangeListResult>('app_server_pending_change_list');

export const addDesktopAppServerPendingChange = (change: AppServerPendingChange) =>
  invokeTauri<AppServerPendingChange>('app_server_pending_change_add', {
    change,
  });

export const updateDesktopAppServerPendingChangeData = (id: number, data: unknown) =>
  invokeTauri<void>('app_server_pending_change_update_data', { id, data });

export const deleteDesktopAppServerPendingChange = (id: number) =>
  invokeWithArg<void>('app_server_pending_change_delete', 'id', id);

export const clearDesktopAppServerPendingChanges = () =>
  invokeTauri<void>('app_server_pending_change_clear');

export const getDesktopAppServerSyncStatus = () =>
  invokeTauri<AppServerSyncStatus>('app_server_sync_status');

export const configureDesktopAppServerSync = (params: {
  deviceId?: string | null;
  lastSyncVersion?: number | null;
}) => invokeTauri<AppServerSyncStatus>('app_server_sync_configure', params);

export const ensureDesktopAppServerSyncDevice = () =>
  invokeTauri<AppServerSyncDevice>('app_server_sync_ensure_device');

export const clearDesktopAppServerMetadata = () =>
  invokeTauri<void>('app_server_metadata_clear_all');

export const getDesktopAppServerQuickMode = () =>
  invokeTauri<AppServerModeResult>('app_server_quick_mode_get');

export const setDesktopAppServerQuickMode = (enabled: boolean) =>
  invokeTauri<AppServerModeResult>('app_server_quick_mode_set', { enabled });

export const getDesktopAppServerAutonomousMode = () =>
  invokeTauri<AppServerModeResult>('app_server_autonomous_mode_get');

export const setDesktopAppServerAutonomousMode = (enabled: boolean) =>
  invokeTauri<AppServerModeResult>('app_server_autonomous_mode_set', {
    enabled,
  });

export const getDesktopAppServerComputerUseMode = () =>
  invokeTauri<AppServerModeResult>('app_server_computer_use_mode_get');

export const setDesktopAppServerComputerUseMode = (enabled: boolean) =>
  invokeTauri<AppServerModeResult>('app_server_computer_use_mode_set', {
    enabled,
  });

export const getDesktopAppServerHybridMode = () =>
  invokeTauri<AppServerHybridModeResult>('app_server_hybrid_mode_get');

export const setDesktopAppServerHybridMode = (params: AppServerHybridModeSetParams) =>
  invokeTauri<AppServerHybridModeResult>('app_server_hybrid_mode_set', {
    enabled: params.enabled,
    modelId: params.modelId,
    role: params.role,
  });

export const getDesktopAppServerLocalSettings = () =>
  invokeTauri<AppServerLocalSettingsResult>('app_server_local_settings_get');

export const updateDesktopAppServerLocalSettings = (params: AppServerLocalSettingsUpdate) =>
  invokeWithParams<AppServerLocalSettingsResult>('app_server_local_settings_update', params);

export const listDesktopAppServerModels = () =>
  invokeTauri<AppServerModelListResult>('app_server_model_list');

export const selectDesktopAppServerModel = (modelId: string) =>
  invokeTauri<AppServerModelListResult>('app_server_model_select', { modelId });

export const resetDesktopAppServerModel = () =>
  invokeTauri<AppServerModelListResult>('app_server_model_reset');

export const listDesktopAppServerSkills = () =>
  invokeTauri<AppServerSkillListResult>('app_server_skill_list');

export const listDesktopAppServerPlugins = () =>
  invokeTauri<AppServerPluginListResult>('app_server_plugin_list');

export const setDesktopAppServerPluginEnabled = (pluginId: string, enabled: boolean) =>
  invokeTauri<AppServerPluginListResult>('app_server_plugin_set_enabled', {
    pluginId,
    enabled,
  });

export const getDesktopAppServerComputerUseStatus = () =>
  invokeTauri<AppServerComputerUseStatus>('app_server_computer_use_status');

export const getDesktopAppServerBrowserStatus = () =>
  invokeTauri<AppServerBrowserStatus>('app_server_browser_status');

export const getDesktopAppServerContextSummary = () =>
  invokeTauri<AppServerContextSummary>('app_server_context_summary');

export const getDesktopAppServerMemorySummary = () =>
  invokeTauri<AppServerMemorySummary>('app_server_memory_summary');

export const getDesktopScreenMemoryStatus = () =>
  invokeTauri<DesktopScreenMemoryStatus>('screen_memory_status');

export const setDesktopScreenMemoryEnabled = (enabled: boolean) =>
  invokeTauri<DesktopScreenMemoryStatus>('set_screen_memory_enabled', { enabled });

export const setDesktopScreenMemoryPaused = (paused: boolean) =>
  invokeTauri<DesktopScreenMemoryStatus>('set_screen_memory_paused', { paused });

export const captureDesktopScreenMemoryNow = () =>
  invokeTauri<DesktopScreenMemoryStatus>('screen_memory_capture_now');

export const getDesktopAppServerOllamaStatus = (baseUrl?: string | null) =>
  invokeTauri<AppServerOllamaStatus>('app_server_ollama_status', { baseUrl });

export const ensureDesktopAppServerOllama = (params?: {
  baseUrl?: string | null;
  modelId?: string | null;
}) =>
  invokeTauri<AppServerOllamaEnsureResult>('app_server_ollama_ensure', {
    baseUrl: params?.baseUrl,
    modelId: params?.modelId,
  });
