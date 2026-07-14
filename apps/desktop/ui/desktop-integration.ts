import {
  configureDesktopApi,
  type DesktopApi,
} from '@taskforceai/web/app/lib/platform/desktop-api';
import {
  configureDesktopUi,
  type DesktopUiIntegration,
} from '@taskforceai/web/app/lib/platform/desktop-ui';

import { DesktopAgentManagerPanel } from './app-shell/DesktopAgentManagerPanel';
import { DesktopAuthButtons } from './app-shell/DesktopAuthButtons';
import { DesktopBrowserPanel } from './app-shell/DesktopBrowserPanel';
import { DesktopCodeOpenInMenu } from './app-shell/DesktopCodeOpenInMenu';
import { DesktopCodeWorkspaceSurface } from './app-shell/DesktopCodeWorkspaceSurface';
import { DesktopCompanion } from './app-shell/DesktopCompanion';
import { DesktopTerminalPanel } from './app-shell/DesktopTerminalPanel';
import { WorkspaceFileTreePanel } from './app-shell/WorkspaceFileTreePanel';
import { useDesktopBrowserPreview } from './app-shell/useDesktopBrowserPreview';
import { useDesktopCompanionPet } from './app-shell/useDesktopCompanionPet';
import { useDesktopMenuActions } from './app-shell/useDesktopMenuActions';
import { useDesktopShellActions } from './app-shell/useDesktopShellActions';
import * as appServer from './platform/app-server';
import { waitForTauriBridge, invokeTauri } from './platform/bridge';
import { createDesktopConversationStore } from './platform/conversation-store';
import { disableDesktopConsoleLogs } from './platform/disableDesktopConsoleLogs';
import { callDesktopMcpTool, inspectDesktopMcpServer } from './platform/mcp';
import { createDesktopStreamingRuntime } from './platform/streaming-runtime';
import { createDesktopSyncClient } from './platform/sync-client';
import { createDesktopVoiceGatewayRequestOptions } from './platform/voice-gateway';
import {
  DesktopAppshotsSection,
  DesktopBrowserUseSection,
  DesktopComputerUseSection,
  DesktopEnvironmentsSection,
  DesktopLocalSection,
  DesktopWorktreesSection,
} from './profile/ProfileDesktopLocalSection';
import { PairingSections } from './profile/ProfileDesktopPairingSection';
import { DesktopProjectsSidebar } from './shell/DesktopProjectsSidebar';
import { DesktopUpdateButton } from './shell/DesktopUpdateButton';
import { tauriStorage } from './storage/tauri-adapter';
import { useDesktopRealtimeVoiceSession } from './voice/useDesktopRealtimeVoiceSession';

const desktopApi: DesktopApi = {
  createConversationStore: createDesktopConversationStore,
  createStreamingRuntime: createDesktopStreamingRuntime,
  storageAdapter: tauriStorage,
  createSyncClient: createDesktopSyncClient,
  createVoiceGatewayRequestOptions: createDesktopVoiceGatewayRequestOptions,
  waitForBridge: waitForTauriBridge,
  invoke: invokeTauri,
  getAuthStatus: appServer.getDesktopAppServerAuthStatus,
  getLocalSettings: appServer.getDesktopAppServerLocalSettings,
  logout: appServer.logoutDesktopAppServerAuth,
  startDeviceLogin: appServer.startDesktopAppServerDeviceLogin,
  pollDeviceLogin: appServer.pollDesktopAppServerDeviceLogin,
  openExternalUrl: appServer.openDesktopExternalUrl,
  enableLocalCoding: appServer.enableDesktopLocalCoding,
  disableLocalCoding: appServer.disableDesktopLocalCoding,
  submitRun: appServer.submitDesktopAppServerRun,
  getComputerUseMode: appServer.getDesktopAppServerComputerUseMode,
  setComputerUseMode: appServer.setDesktopAppServerComputerUseMode,
  executeCommand: appServer.executeDesktopAppServerCommand,
  observeComputerUse: appServer.observeDesktopComputerUse,
  openBrowserPreview: appServer.openDesktopBrowserPreview,
  showBrowserPreview: appServer.showDesktopBrowserPreview,
  createRecordReplaySkill: appServer.createDesktopRecordReplaySkill,
  listModels: appServer.listDesktopAppServerModels,
  listPlugins: appServer.listDesktopAppServerPlugins,
  setPluginEnabled: appServer.setDesktopAppServerPluginEnabled,
  getContextSummary: appServer.getDesktopAppServerContextSummary,
  updateLocalSettings: appServer.updateDesktopAppServerLocalSettings,
  getStatus: appServer.getDesktopAppServerStatus,
  inspectMcpServer: inspectDesktopMcpServer,
  callMcpTool: callDesktopMcpTool,
};

const desktopUi: DesktopUiIntegration = {
  AgentManagerPanel: DesktopAgentManagerPanel,
  Companion: DesktopCompanion,
  CodeWorkspaceSurface: DesktopCodeWorkspaceSurface,
  AuthButtons: DesktopAuthButtons,
  BrowserPanel: DesktopBrowserPanel,
  TerminalPanel: DesktopTerminalPanel,
  WorkspaceFileTreePanel,
  CodeOpenInMenu: DesktopCodeOpenInMenu,
  UpdateButton: DesktopUpdateButton,
  ProjectsSidebar: DesktopProjectsSidebar,
  DesktopLocalSection,
  DesktopBrowserUseSection,
  DesktopComputerUseSection,
  DesktopAppshotsSection,
  DesktopEnvironmentsSection,
  DesktopWorktreesSection,
  PairingSections,
  disableConsoleLogs: disableDesktopConsoleLogs,
  useBrowserPreview: useDesktopBrowserPreview,
  useCompanionPet: useDesktopCompanionPet,
  useMenuActions: useDesktopMenuActions,
  useShellActions: useDesktopShellActions,
  useRealtimeVoiceSession: useDesktopRealtimeVoiceSession,
};

export const installDesktopIntegrations = (): void => {
  configureDesktopApi(desktopApi);
  configureDesktopUi(desktopUi);
};
