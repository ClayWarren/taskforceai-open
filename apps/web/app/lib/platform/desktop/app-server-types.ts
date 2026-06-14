import type { McpRuntimeToolDescriptor, ResearchWorkflowOption } from '@taskforceai/shared';

export type AppServerRunStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type AppServerHttpPairingInfo = {
  baseUrl: string;
  pairingCode: string;
  rpcPath: string;
  transport: {
    kind: string;
    encoding: string;
  };
};
export type AppServerSshProbeParams = {
  target: string;
};
export type AppServerSshProbeResult = {
  target: string;
  reachable: boolean;
  appServerAvailable: boolean;
  appServerPath?: string | null;
  shell?: string | null;
  message: string;
};
export type AppServerSshConnectParams = {
  target: string;
  appServerPath?: string | null;
  remotePort?: number | null;
};
export type AppServerSshConnectResult = {
  target: string;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localPort: number;
  remotePort: number;
  pairing: AppServerHttpPairingInfo;
  message: string;
};
export type AppServerEnvironmentStatus = {
  active: 'local' | 'remote';
  target?: string | null;
  localBaseUrl?: string | null;
  remoteBaseUrl?: string | null;
  localPort?: number | null;
  remotePort?: number | null;
  remoteConnected: boolean;
};
export type DesktopWorkspaceFileTreeEntry = {
  path: string;
  name: string;
  depth: number;
  isDirectory: boolean;
};
export type DesktopWorkspaceFileTreeParams = {
  maxEntries?: number;
  maxDepth?: number;
};
export type DesktopWorkspaceFileTreeResult = {
  root: string;
  entries: DesktopWorkspaceFileTreeEntry[];
  truncated: boolean;
};
export type DesktopWorkspaceFileReadParams = {
  path: string;
  maxBytes?: number;
};
export type DesktopWorkspaceFileReadResult = {
  root: string;
  path: string;
  content: string;
  truncated: boolean;
};
export type AppServerRunRecord = {
  id: string;
  prompt: string;
  modelId: string | null;
  projectId: number | null;
  status: AppServerRunStatus;
  output: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  toolEvents?: unknown[];
  sources?: unknown[];
  agentStatuses?: unknown[];
  pendingApproval?: unknown;
};
export type AppServerStatusSummary = {
  transport: string;
  authenticated: boolean;
  runCount: number;
  modelId: string;
  quickMode: boolean;
  autonomous: boolean;
  computerUse: boolean;
  pet: AppServerPetState;
};
export type AppServerPetState = {
  name: string;
  mood: string;
  visible: boolean;
  message: string;
};
export type AppServerPetSetParams = {
  name?: string | null;
  mood?: string | null;
  visible?: boolean | null;
};
export type AppServerPetResult = {
  pet: AppServerPetState;
};
export type AppServerCommandExecuteParams = {
  input: string;
};
export type AppServerCommandExecuteResult = {
  handled: boolean;
  title: string;
  message: string;
};
export type AppServerAgentSession = {
  sessionId: string;
  title: string;
  objective: string;
  state: string;
  source: string;
  parentSessionId?: string | null;
  lastMessage?: string | null;
  runIds?: string[];
  activeRunId?: string | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
};
export type AppServerAgentSessionCreateParams = {
  objective: string;
  title?: string | null;
  source?: string | null;
};
export type AppServerAgentSessionMessageParams = {
  sessionId: string;
  message: string;
};
export type AppServerAgentSessionRunParams = {
  sessionId: string;
  prompt?: string | null;
  modelId?: string | null;
  quickMode?: boolean | null;
  autonomous?: boolean | null;
  computerUse?: boolean | null;
  useLoggedInServices?: boolean | null;
  agentCount?: number | null;
  projectId?: number | null;
  attachmentIds?: string[];
};
export type AppServerAgentSessionListResult = {
  sessions: AppServerAgentSession[];
};
export type AppServerAgentSessionResult = {
  session: AppServerAgentSession;
};
export type AppServerAgentSessionRunResult = {
  session: AppServerAgentSession;
  run: AppServerRunRecord;
};
export type AppServerThreadStartParams = {
  objective: string;
  threadId?: string | null;
  title?: string | null;
  source?: string | null;
};
export type AppServerThreadIdParams = {
  threadId: string;
};
export type AppServerThreadListResult = {
  threads: AppServerAgentSession[];
};
export type AppServerThreadResult = {
  thread: AppServerAgentSession;
};
export type AppServerTurnStartParams = {
  threadId: string;
  input: string;
  modelId?: string | null;
  quickMode?: boolean | null;
  autonomous?: boolean | null;
  computerUse?: boolean | null;
  useLoggedInServices?: boolean | null;
  agentCount?: number | null;
  projectId?: number | null;
  attachmentIds?: string[];
};
export type AppServerTurnSteerParams = {
  threadId: string;
  input: string;
};
export type AppServerTurnInterruptParams = {
  threadId: string;
};
export type AppServerTurnResult = {
  thread: AppServerAgentSession;
  run: AppServerRunRecord;
};
export type AppServerDiagnosticItem = {
  label: string;
  value: string;
};
export type AppServerDiagnosticSection = {
  title: string;
  items: AppServerDiagnosticItem[];
};
export type AppServerDiagnosticsInspectResult = {
  sections: AppServerDiagnosticSection[];
  suggestions: string[];
};
export type AppServerChannel = {
  channelId: string;
  name: string;
  kind: string;
  enabled: boolean;
  targetSessionId?: string | null;
  lastMessage?: string | null;
  createdAt: number;
  updatedAt: number;
};
export type AppServerChannelAddParams = {
  name: string;
  kind?: string;
  targetSessionId?: string | null;
  enabled?: boolean;
};
export type AppServerChannelPushParams = {
  channelId: string;
  message: string;
  dispatch?: boolean;
};
export type AppServerChannelListResult = {
  channels: AppServerChannel[];
};
export type AppServerChannelResult = {
  channel: AppServerChannel;
  session?: AppServerAgentSession | null;
  run?: AppServerRunRecord | null;
};
export type AppServerSchedule = {
  scheduleId: string;
  name: string;
  prompt: string;
  cadence: string;
  enabled: boolean;
  targetSessionId?: string | null;
  nextRunAt?: number | null;
  createdAt: number;
  updatedAt: number;
};
export type AppServerScheduleAddParams = {
  name: string;
  prompt: string;
  cadence: string;
  targetSessionId?: string | null;
  enabled?: boolean;
};
export type AppServerScheduleListResult = {
  schedules: AppServerSchedule[];
};
export type AppServerScheduleResult = {
  schedule: AppServerSchedule;
};
export type AppServerScheduleTickParams = {
  now?: number | null;
};
export type AppServerScheduleDispatch = {
  scheduleId: string;
  name: string;
  run: AppServerRunRecord;
  session?: AppServerAgentSession | null;
};
export type AppServerScheduleTickResult = {
  dispatched: AppServerScheduleDispatch[];
  nextDueAt?: number | null;
};
export type AppServerAuthStatus = {
  authenticated: boolean;
  user?: {
    id?: string | null;
    email?: string | null;
    fullName?: string | null;
    image?: string | null;
  } | null;
};
export type AppServerDeviceLoginStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};
export type AppServerDeviceLoginPoll = {
  status: string;
  token?: string | null;
  expiresIn?: number | null;
  interval?: number | null;
  message?: string | null;
};
export type AppServerHistoryListResult = {
  runs: AppServerRunRecord[];
};
export type AppServerSubmitRunParams = {
  prompt: string;
  modelId?: string | null;
  quickMode?: boolean | null;
  autonomous?: boolean | null;
  computerUse?: boolean | null;
  computerUseTarget?: 'virtual' | 'local' | null;
  useLoggedInServices?: boolean | null;
  agentCount?: number | null;
  projectId?: number | null;
  attachmentIds?: string[];
  clientMcpTools?: McpRuntimeToolDescriptor[];
  researchWorkflow?: ResearchWorkflowOption | null;
};
export type AppServerSubmitRunResult = {
  run: AppServerRunRecord;
};
export type AppServerEnableLocalCodingParams = {
  workspace?: string | null;
};
export type AppServerEnableLocalCodingResult = {
  workspace: string;
  serverName: string;
  serverNames?: string[];
};
export type AppServerRunStatusResult = {
  run: AppServerRunRecord;
};
export type AppServerPendingChange = {
  id?: number | null;
  type: string;
  entityId: string;
  operation: string;
  data: unknown;
  createdAt: number;
};
export type AppServerPendingChangeListResult = {
  pendingChanges: AppServerPendingChange[];
};
export type AppServerSyncStatus = {
  deviceId?: string | null;
  lastSyncVersion: number;
  configured: boolean;
};
export type AppServerSyncDevice = {
  deviceId: string;
  generated: boolean;
};
export type AppServerModeResult = {
  enabled: boolean;
};
export type AppServerHybridModeResult = {
  enabled: boolean;
  role: string;
  modelId?: string | null;
  recommendedModelId: string;
  message: string;
  orchestration: {
    roles: Array<{
      name: string;
      description: string;
      modelId?: string | null;
    }>;
    budget?: number | null;
  };
};
export type AppServerHybridModeSetParams = {
  enabled: boolean;
  modelId?: string | null;
  role?: string | null;
};
export type AppServerLocalSettings = {
  theme: string;
  telemetryEnabled: boolean;
  telemetryDsn: string;
  telemetryEnvironment: string;
  loggingLevel: string;
  loggingFormat: string;
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
  codeExecutionEnabled: boolean;
  trustLayerEnabled: boolean;
  notificationsEnabled: boolean;
};
export type AppServerLocalSettingsUpdate = Partial<AppServerLocalSettings>;
export type AppServerLocalSettingsResult = {
  settings: AppServerLocalSettings;
};
export type AppServerModelOption = {
  id: string;
  label: string;
  badge: string;
  description?: string | null;
  usageMultiple?: number | null;
};
export type AppServerModelListResult = {
  enabled: boolean;
  options: AppServerModelOption[];
  defaultModelId: string;
  selectedModelId?: string | null;
  remoteCatalog: boolean;
};
export type AppServerSkillListResult = {
  skills: Array<{
    name: string;
    description: string;
    path: string;
    source: string;
  }>;
  truncated: boolean;
};
export type AppServerPluginListResult = {
  plugins: Array<{
    id: string;
    name: string;
    path: string;
    enabled: boolean;
    source?: string;
    description?: string;
  }>;
};
export type AppServerCapabilityStatus = {
  supported: boolean;
  installed: boolean;
  message: string;
};
export type AppServerComputerUseStatus = AppServerCapabilityStatus & {
  permissionRequired: boolean;
  lockedUseSupported: boolean;
};
export type AppServerBrowserStatus = AppServerCapabilityStatus & {
  supportsAuth: boolean;
};
export type AppServerContextSummary = {
  maxTokens: number;
  estimatedTokens: number;
  items: Array<{
    label: string;
    category: string;
    estimatedTokens: number;
    visible: boolean;
    survivesCompact: boolean;
  }>;
  suggestions: string[];
};
export type AppServerMemorySummary = {
  sources: Array<{
    scope: string;
    path: string;
    exists: boolean;
    bytes: number;
    estimatedTokens: number;
  }>;
  estimatedTokens: number;
  suggestions: string[];
};
export type DesktopScreenMemoryStatus = {
  supported: boolean;
  enabled: boolean;
  paused: boolean;
  captureDirectory: string;
  memoryPath?: string | null;
  latestCapturePath?: string | null;
  latestCaptureAt?: number | null;
  captureCount: number;
  bytes: number;
  message: string;
};
export type AppServerOllamaStatus = {
  providerId: string;
  baseUrl: string;
  hostRoot: string;
  connected: boolean;
  openaiCompatible: boolean;
  responsesSupported?: boolean | null;
  version?: string | null;
  models: string[];
  defaultModel: string;
  memory: {
    totalBytes?: number | null;
    totalLabel: string;
    recommendedModelId: string;
    recommendedModel: string;
    minimumBytes: number;
    reason: string;
  };
  message?: string | null;
};
export type AppServerOllamaPullEvent =
  | { type: 'status'; message: string }
  | {
      type: 'progress';
      digest?: string | null;
      completed?: number | null;
      total?: number | null;
    }
  | { type: 'success' }
  | { type: 'error'; message: string };
export type AppServerOllamaEnsureResult = {
  status: AppServerOllamaStatus;
  model: string;
  pulled: boolean;
  pullEvents: AppServerOllamaPullEvent[];
};
