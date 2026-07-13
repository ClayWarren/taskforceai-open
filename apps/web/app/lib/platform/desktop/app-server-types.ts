import type * as Generated from './app-server-types.generated';

export type * from './app-server-types.generated';

export type AppServerCapabilityStatus = {
  supported: boolean;
  installed: boolean;
  message: string;
};

export type AppServerRunStatus = Generated.RunStatus;
export type AppServerRunRecord = Generated.RunRecord;
export type AppServerStatusSummary = Generated.StatusSummaryResult;
export type AppServerPetState = Generated.PetState;
export type AppServerPetSetParams = Generated.PetSetParams;
export type AppServerPetResult = Generated.PetResult;
export type AppServerCommandExecuteParams = Generated.CommandExecuteParams;
export type AppServerCommandExecuteResult = Generated.CommandExecuteResult;
export type AppServerAgentSession = Generated.AgentSessionRecord;
export type AppServerAgentSessionCreateParams = Generated.AgentSessionCreateParams;
export type AppServerAgentSessionMessageParams = Generated.AgentSessionMessageParams;
export type AppServerAgentSessionRunParams = Generated.AgentSessionRunParams;
export type AppServerAgentSessionListResult = Generated.AgentSessionListResult;
export type AppServerAgentSessionResult = Generated.AgentSessionResult;
export type AppServerAgentSessionRunResult = Generated.AgentSessionRunResult;
export type AppServerThreadStartParams = Generated.ThreadStartParams;
export type AppServerThreadIdParams = Generated.ThreadIDParams;
export type AppServerThreadListResult = Generated.ThreadListResult;
export type AppServerThreadResult = Generated.ThreadResult;
export type AppServerTurnStartParams = Generated.TurnStartParams;
export type AppServerTurnSteerParams = Generated.TurnSteerParams;
export type AppServerTurnInterruptParams = Generated.TurnInterruptParams;
export type AppServerTurnResult = Generated.TurnResult;
export type AppServerDiagnosticItem = Generated.DiagnosticItem;
export type AppServerDiagnosticSection = Generated.DiagnosticSection;
export type AppServerDiagnosticsInspectResult = Generated.DiagnosticsInspectResult;
export type AppServerChannel = Generated.ChannelRecord;
export type AppServerChannelAddParams = Generated.ChannelAddParams;
export type AppServerChannelPushParams = Generated.ChannelPushParams;
export type AppServerChannelListResult = Generated.ChannelListResult;
export type AppServerChannelResult = Generated.ChannelResult;
export type AppServerSchedule = Generated.ScheduleRecord;
export type AppServerScheduleAddParams = Generated.ScheduleAddParams;
export type AppServerScheduleListResult = Generated.ScheduleListResult;
export type AppServerScheduleResult = Generated.ScheduleResult;
export type AppServerScheduleTickParams = Generated.ScheduleTickParams;
export type AppServerScheduleDispatch = Generated.ScheduleDispatchRecord;
export type AppServerScheduleTickResult = Generated.ScheduleTickResult;
export type AppServerAuthStatus = Generated.AuthStatus;
export type AppServerDeviceLoginStart = Generated.DeviceLoginStartResult;
export type AppServerDeviceLoginPoll = Generated.DeviceLoginPollResult;
export type AppServerHistoryListResult = Generated.HistoryListResult;
export type AppServerSubmitRunParams = Generated.SubmitRunParams;
export type AppServerSubmitRunResult = Generated.SubmitRunResult;
export type AppServerEnableLocalCodingParams = Generated.DesktopLocalCodingParams;
export type AppServerEnableLocalCodingResult = Generated.DesktopLocalCodingResult;
export type AppServerGitReviewScope =
  | 'uncommitted'
  | 'staged'
  | 'unstaged'
  | 'allBranchChanges'
  | 'lastTurn';
export type AppServerGitReviewStatusParams = Generated.GitReviewStatusParams;
export type AppServerGitReviewDiffParams = Omit<Generated.GitReviewDiffParams, 'scope'> & {
  scope?: AppServerGitReviewScope;
};
export type AppServerGitReviewFileStatus = Generated.GitReviewFileStatus;
export type AppServerGitReviewPullRequestReview = Generated.GitReviewPullRequestReview;
export type AppServerGitReviewPullRequest = Generated.GitReviewPullRequest;
export type AppServerGitReviewStatusResult = Generated.GitReviewStatusResult;
export type AppServerGitReviewDiffFile = Generated.GitReviewDiffFile;
export type AppServerGitReviewDiffResult = Omit<Generated.GitReviewDiffResult, 'scope'> & {
  scope: AppServerGitReviewScope;
};
export type AppServerGitReviewStageParams = Generated.GitReviewStageParams;
export type AppServerGitReviewComment = Generated.GitReviewCommentRecord;
export type AppServerGitReviewCommentListParams = Generated.GitReviewCommentListParams;
export type AppServerGitReviewCommentListResult = Generated.GitReviewCommentListResult;
export type AppServerGitReviewCommentAddParams = Generated.GitReviewCommentAddParams;
export type AppServerGitReviewCommentResolveParams = Generated.GitReviewCommentResolveParams;
export type AppServerGitReviewCommentResult = Generated.GitReviewCommentResult;
export type AppServerGitReviewPullRequestAction =
  | 'comment'
  | 'approve'
  | 'requestChanges'
  | 'markReady';
export type AppServerGitReviewPullRequestActionParams = Omit<
  Generated.GitReviewPullRequestActionParams,
  'action'
> & { action: AppServerGitReviewPullRequestAction };
export type AppServerGitReviewActionResult = Generated.GitReviewActionResult;
export type AppServerRunStatusResult = Generated.RunStatusResult;
export type AppServerPendingChange = Generated.PendingChangeRecord;
export type AppServerPendingChangeListResult = Generated.PendingChangeListResult;
export type AppServerSyncStatus = Generated.SyncStatusResult;
export type AppServerSyncDevice = Generated.SyncDeviceResult;
export type AppServerModeResult = Generated.QuickModeResult;
export type AppServerHybridModeResult = Generated.HybridModeResult;
export type AppServerHybridModeSetParams = Generated.HybridModeSetParams;
export type AppServerLocalSettings = Generated.LocalSettings;
export type AppServerLocalSettingsUpdate = Generated.LocalSettingsUpdateParams;
export type AppServerLocalSettingsResult = Generated.LocalSettingsResult;
export type AppServerModelOption = Generated.ModelOptionRecord;
export type AppServerModelListResult = Generated.ModelListResult;
export type AppServerSkillListResult = Generated.SkillListResult;
export type AppServerPluginListResult = Generated.PluginListResult;
export type AppServerAttachmentRecord = Generated.AttachmentRecord;
export type AppServerAttachmentListResult = Generated.AttachmentListResult;
export type AppServerAttachmentAddParams = Generated.AttachmentAddParams;
export type AppServerAttachmentAddResult = Generated.AttachmentAddResult;
export type AppServerComputerUseStatus = Generated.ComputerUseStatusResult;
export type AppServerBrowserStatus = Generated.BrowserStatusResult;
export type AppServerContextSummary = Generated.ContextSummaryResult;
export type AppServerMemorySummary = Generated.MemorySummaryResult;
export type AppServerOllamaStatus = Generated.OllamaStatusResult;
export type AppServerOllamaPullEvent = Generated.OllamaPullEventRecord;
export type AppServerOllamaEnsureResult = Generated.OllamaEnsureResult;
export type AppServerVoiceTranscribeParams = Generated.VoiceTranscribeParams;
export type AppServerVoiceTranscribeResult = Generated.VoiceTranscribeResult;
export type AppServerVoiceSpeechGenerateParams = Generated.VoiceSpeechGenerateParams;
export type AppServerVoiceSpeechGenerateResult = Generated.VoiceSpeechGenerateResult;
export type AppServerVoiceRealtimeSetupParams = Generated.VoiceRealtimeSetupParams;
export type AppServerVoiceRealtimeSetupResult = Generated.VoiceRealtimeSetupResult;
export type AppServerHttpPairingInfo = Generated.DesktopHttpPairingInfo;
export type AppServerSshProbeParams = Generated.DesktopSshProbeParams;
export type AppServerSshProbeResult = Generated.DesktopSshProbeResult;
export type AppServerSshConnectParams = Generated.DesktopSshConnectParams;
export type AppServerSshConnectResult = Generated.DesktopSshConnectResult;
export type AppServerEnvironmentStatus = Generated.DesktopAppServerEnvironmentStatus;
export type AppServerThreadLocation = Generated.DesktopThreadLocation;
export type AppServerThreadHandoffParams = Generated.DesktopThreadHandoffParams;
export type AppServerThreadHandoffResult = Generated.DesktopThreadHandoffResult;
export type DesktopLocalEnvironmentScripts = Generated.LocalEnvironmentScripts;
export type DesktopLocalEnvironmentAction = Generated.LocalEnvironmentAction;
export type DesktopLocalEnvironmentConfig = Generated.LocalEnvironmentConfig;
export type DesktopLocalEnvironmentStatus = Generated.LocalEnvironmentStatus;
export type DesktopLocalEnvironmentUpdateParams = Generated.LocalEnvironmentUpdateParams;
export type DesktopLocalEnvironmentActionRunParams = Generated.LocalEnvironmentActionRunParams;
export type DesktopWorkspaceFileTreeEntry = Generated.WorkspaceFileTreeEntry;
export type DesktopWorkspaceFileTreeParams = Generated.WorkspaceFileTreeParams;
export type DesktopWorkspaceFileTreeResult = Generated.WorkspaceFileTreeResult;
export type DesktopWorkspaceFileReadParams = Generated.DesktopWorkspaceFileReadParams;
export type DesktopWorkspaceFileReadResult = Generated.DesktopWorkspaceFileReadResult;
export type DesktopWorkspaceFileWriteParams = Generated.DesktopWorkspaceFileWriteParams;
export type DesktopWorktree = Generated.GitWorktree;
export type DesktopWorktreeListResult = Generated.GitWorktreeListResult;
export type DesktopWorktreeCreateResult = Generated.GitWorktreeCreateResult;
export type DesktopScreenMemoryStatus = Generated.ScreenMemoryStatus;
export type DesktopComputerUseObserveResult = Generated.ScreenCaptureResult;
export type DesktopAppshotCaptureResult = Generated.AppshotCaptureResult;
