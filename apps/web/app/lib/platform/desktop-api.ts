import { getStoredToken } from '@taskforceai/api-client/auth/auth-storage';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import type {
  AppServerAuthStatus,
  AppServerCommandExecuteParams,
  AppServerCommandExecuteResult,
  AppServerContextSummary,
  AppServerEnableLocalCodingParams,
  AppServerEnableLocalCodingResult,
  AppServerLocalSettingsResult,
  AppServerLocalSettingsUpdate,
  AppServerModeResult,
  AppServerModelListResult,
  AppServerPluginListResult,
  AppServerStatusSummary,
  AppServerSubmitRunParams,
  AppServerSubmitRunResult,
  DesktopBrowserOpenParams,
  DesktopBrowserStatus,
  DesktopComputerUseObserveResult,
  RecordReplaySkillParams,
  RecordReplaySkillResult,
  DesktopWorkspaceCheckpointCaptureParams,
  DesktopWorkspaceCheckpointRestoreParams,
  DesktopWorkspaceCheckpointResult,
} from '@taskforceai/contracts/app-server';
import type { ConversationStore, VoiceGatewayRequestOptions } from '@taskforceai/client-runtime';
import type { StorageAdapter } from '@taskforceai/persistence';
import type { HttpSyncClientOptions, SyncClient } from '@taskforceai/sync-client';

import type { PlatformRuntime, StreamingRuntime } from './platform-interfaces';

export type DesktopMcpServerConfig = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

type DesktopDeviceLoginPollResult = {
  status: string;
  token?: string | null;
  expiresIn?: number | null;
  interval?: number | null;
  message?: string | null;
};

export type DesktopMcpToolSummary = {
  name: string;
  title: string;
  description: string;
};

export type DesktopMcpServerSnapshot = {
  name: string;
  endpoint: string;
  transport: 'stdio' | 'streamable_http';
  protocol_version: string;
  server_name: string;
  server_title: string;
  server_version: string;
  instructions: string;
  tools: DesktopMcpToolSummary[];
  prompts: Array<{ name: string; title: string; description: string }>;
  resources: Array<{
    name: string;
    title: string;
    description: string;
    uri: string;
    mime_type: string;
  }>;
};

type DesktopSyncOptions = Pick<
  HttpSyncClientOptions,
  'onUnauthorized' | 'getCsrfToken' | 'metrics' | 'isProduction'
>;

export interface DesktopApi {
  createConversationStore(): ConversationStore;
  createStreamingRuntime(): StreamingRuntime;
  storageAdapter: StorageAdapter;
  createSyncClient(
    baseUrl: string,
    getToken: () => string | null,
    options?: DesktopSyncOptions
  ): SyncClient;
  createVoiceGatewayRequestOptions(): Promise<VoiceGatewayRequestOptions>;
  waitForBridge(timeoutMs?: number): Promise<boolean>;
  invoke<T = unknown>(
    command: string,
    args?: Record<string, unknown>,
    parseResult?: (_value: unknown) => T
  ): Promise<T>;
  getAuthStatus(): Promise<AppServerAuthStatus>;
  getLocalSettings(): Promise<AppServerLocalSettingsResult>;
  logout(): Promise<AppServerAuthStatus>;
  startDeviceLogin(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  }>;
  pollDeviceLogin(deviceCode: string): Promise<DesktopDeviceLoginPollResult>;
  openExternalUrl(url: string): Promise<void>;
  enableLocalCoding(
    params?: AppServerEnableLocalCodingParams
  ): Promise<AppServerEnableLocalCodingResult>;
  disableLocalCoding(): Promise<{ enabled: boolean; workspace: string | null }>;
  submitRun(params: AppServerSubmitRunParams): Promise<AppServerSubmitRunResult>;
  captureWorkspaceCheckpoint(
    params: DesktopWorkspaceCheckpointCaptureParams
  ): Promise<DesktopWorkspaceCheckpointResult>;
  restoreWorkspaceCheckpoint(
    params: DesktopWorkspaceCheckpointRestoreParams
  ): Promise<DesktopWorkspaceCheckpointResult>;
  getComputerUseMode(): Promise<AppServerModeResult>;
  setComputerUseMode(enabled: boolean): Promise<AppServerModeResult>;
  executeCommand(params: AppServerCommandExecuteParams): Promise<AppServerCommandExecuteResult>;
  observeComputerUse(): Promise<DesktopComputerUseObserveResult>;
  openBrowserPreview(params: DesktopBrowserOpenParams): Promise<DesktopBrowserStatus>;
  showBrowserPreview(): Promise<DesktopBrowserStatus>;
  createRecordReplaySkill(params: RecordReplaySkillParams): Promise<RecordReplaySkillResult>;
  listModels(): Promise<AppServerModelListResult>;
  listPlugins(): Promise<AppServerPluginListResult>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<AppServerPluginListResult>;
  getContextSummary(): Promise<AppServerContextSummary>;
  updateLocalSettings(params: AppServerLocalSettingsUpdate): Promise<AppServerLocalSettingsResult>;
  getStatus(): Promise<AppServerStatusSummary>;
  inspectMcpServer(server: DesktopMcpServerConfig): Promise<DesktopMcpServerSnapshot>;
  callMcpTool(
    server: DesktopMcpServerConfig,
    name: string,
    argumentsObject?: Record<string, unknown>
  ): Promise<unknown>;
}

let desktopApi: DesktopApi | null = null;

export const configureDesktopApi = (api: DesktopApi | null): void => {
  desktopApi = api;
};

const requireDesktopApi = (): DesktopApi => {
  if (!desktopApi) {
    throw new Error('Desktop capabilities are unavailable in the web application.');
  }
  return desktopApi;
};

export const createDesktopConversationStore = (): ConversationStore =>
  requireDesktopApi().createConversationStore();

export const createDesktopStreamingRuntime = (): StreamingRuntime =>
  requireDesktopApi().createStreamingRuntime();

export const getDesktopStorageAdapter = (): StorageAdapter => requireDesktopApi().storageAdapter;

export const createDesktopSyncClient = (
  baseUrl: string,
  getToken: () => string | null,
  options: DesktopSyncOptions = {}
): SyncClient => requireDesktopApi().createSyncClient(baseUrl, getToken, options);

export const waitForTauriBridge = (timeoutMs?: number): Promise<boolean> =>
  desktopApi ? desktopApi.waitForBridge(timeoutMs) : Promise.resolve(false);

export const invokeTauri = <T = unknown>(
  command: string,
  args?: Record<string, unknown>,
  parseResult?: (_value: unknown) => T
): Promise<T> => requireDesktopApi().invoke(command, args, parseResult);

export const getDesktopAppServerAuthStatus = () => requireDesktopApi().getAuthStatus();
export const getDesktopAppServerLocalSettings = () => requireDesktopApi().getLocalSettings();
export const logoutDesktopAppServerAuth = () => requireDesktopApi().logout();
export const startDesktopAppServerDeviceLogin = () => requireDesktopApi().startDeviceLogin();
export const pollDesktopAppServerDeviceLogin = (deviceCode: string) =>
  requireDesktopApi().pollDeviceLogin(deviceCode);
export const openDesktopExternalUrl = (url: string) => requireDesktopApi().openExternalUrl(url);
export const enableDesktopLocalCoding = (params: AppServerEnableLocalCodingParams = {}) =>
  requireDesktopApi().enableLocalCoding(params);
export const disableDesktopLocalCoding = () => requireDesktopApi().disableLocalCoding();
export const submitDesktopAppServerRun = (params: AppServerSubmitRunParams) =>
  requireDesktopApi().submitRun(params);
export const captureDesktopWorkspaceCheckpoint = (
  params: DesktopWorkspaceCheckpointCaptureParams
) => requireDesktopApi().captureWorkspaceCheckpoint(params);
export const restoreDesktopWorkspaceCheckpoint = (
  params: DesktopWorkspaceCheckpointRestoreParams
) => requireDesktopApi().restoreWorkspaceCheckpoint(params);
export const getDesktopAppServerComputerUseMode = () => requireDesktopApi().getComputerUseMode();
export const setDesktopAppServerComputerUseMode = (enabled: boolean) =>
  requireDesktopApi().setComputerUseMode(enabled);
export const executeDesktopAppServerCommand = (params: AppServerCommandExecuteParams) =>
  requireDesktopApi().executeCommand(params);
export const observeDesktopComputerUse = () => requireDesktopApi().observeComputerUse();
export const openDesktopBrowserPreview = (params: DesktopBrowserOpenParams) =>
  requireDesktopApi().openBrowserPreview(params);
export const showDesktopBrowserPreview = () => requireDesktopApi().showBrowserPreview();
export const createDesktopRecordReplaySkill = (params: RecordReplaySkillParams) =>
  requireDesktopApi().createRecordReplaySkill(params);
export const listDesktopAppServerModels = () => requireDesktopApi().listModels();
export const listDesktopAppServerPlugins = () => requireDesktopApi().listPlugins();
export const setDesktopAppServerPluginEnabled = (pluginId: string, enabled: boolean) =>
  requireDesktopApi().setPluginEnabled(pluginId, enabled);
export const getDesktopAppServerContextSummary = () => requireDesktopApi().getContextSummary();
export const updateDesktopAppServerLocalSettings = (params: AppServerLocalSettingsUpdate) =>
  requireDesktopApi().updateLocalSettings(params);
export const inspectDesktopMcpServer = (server: DesktopMcpServerConfig) =>
  requireDesktopApi().inspectMcpServer(server);
export const callDesktopMcpTool = (
  server: DesktopMcpServerConfig,
  name: string,
  argumentsObject?: Record<string, unknown>
) => requireDesktopApi().callMcpTool(server, name, argumentsObject);

export const createVoiceGatewayRequestOptions = async (
  runtime: PlatformRuntime
): Promise<VoiceGatewayRequestOptions> => {
  if (runtime === 'desktop') {
    return requireDesktopApi().createVoiceGatewayRequestOptions();
  }

  const csrfToken = await getCsrfToken();
  const token = getStoredToken();
  if (!csrfToken && !token.ok) {
    return {};
  }

  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  if (token.ok) headers.set('authorization', `Bearer ${token.value}`);
  return { headers };
};

export const DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT = 'taskforceai:desktop-auth-changed';

export const dispatchDesktopAppServerAuthChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT));
  }
};
