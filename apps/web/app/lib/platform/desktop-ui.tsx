import type { AppServerPetState } from '@taskforceai/contracts/app-server';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import type { RealtimeVoiceTranscriptMessage } from '@taskforceai/client-runtime';
import type { ComponentType } from 'react';

export type DesktopTaskMode = 'chat' | 'work' | 'code';
export type DesktopUpdateAction = 'idle' | 'checking' | 'installing';
export type DesktopCodeWorkspaceView = 'empty' | 'review';

export const DESKTOP_CODE_WORKSPACE_PANE_WIDTH = 'min(68vw, 1180px)';

export type DesktopAgentManagerPanelProps = {
  open: boolean;
  onClose: () => void;
  taskMode?: DesktopTaskMode;
};

export type DesktopCompanionProps = { pet?: AppServerPetState | null };
export type DesktopCodeWorkspaceSurfaceProps = {
  open: boolean;
  view: DesktopCodeWorkspaceView;
  onOpenChange: (_open: boolean) => void;
  onViewChange: (_view: DesktopCodeWorkspaceView) => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenSideTask?: () => void;
};
export type DesktopAuthButtonsProps = { onSignIn: () => void };
export type DesktopBrowserPanelProps = {
  open: boolean;
  onClose: () => void;
  width?: string;
  developerModeEnabled?: boolean;
};
export type DesktopTerminalPanelProps = { open: boolean; onClose: () => void };
export type WorkspaceFileTreePanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onInsertIntoComposer?: (_text: string) => void;
};
export type DesktopUpdateButtonProps = {
  desktopUpdateVersion: string;
  desktopUpdateAction: DesktopUpdateAction;
  onCheckForUpdates: () => void;
};
export type DesktopProjectsSidebarProps = {
  mode: 'work' | 'code';
  searchQuery: string;
  activeConversationId?: string | null;
  onConversationSelect?: (_conversation: ConversationSummary) => void;
  onClose: () => void;
};

export type DesktopBrowserPreviewState = {
  closeBrowserPreview: () => void;
  isBrowserPreviewOpen: boolean;
  openBrowserPreview: () => void;
};

export type DesktopMenuActionsOptions = {
  desktopRuntime: boolean;
  onCheckForUpdates?: () => void;
  onOpenBrowserPreview: () => void;
  onOpenSettings: () => void;
};

export type DesktopShellActions = {
  availableUpdate: {
    available: boolean;
    currentVersion: string;
    version?: string | null;
    notes?: string | null;
  } | null;
  desktopUpdateAction: DesktopUpdateAction;
  desktopUpdateMessage: string | null;
  handleCheckForUpdates?: () => void;
};

export type DesktopRealtimeVoiceSession = {
  connect: () => Promise<void>;
  disconnect: (_recordEnded?: boolean) => void;
  endedDurationMs: number | null;
  isActive: boolean;
  isCapturing: boolean;
  isPlaying: boolean;
  messages: RealtimeVoiceTranscriptMessage[];
  prewarm: () => void;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
};

export interface DesktopUiIntegration {
  AgentManagerPanel: ComponentType<DesktopAgentManagerPanelProps>;
  Companion: ComponentType<DesktopCompanionProps>;
  CodeWorkspaceSurface: ComponentType<DesktopCodeWorkspaceSurfaceProps>;
  AuthButtons: ComponentType<DesktopAuthButtonsProps>;
  BrowserPanel: ComponentType<DesktopBrowserPanelProps>;
  TerminalPanel: ComponentType<DesktopTerminalPanelProps>;
  WorkspaceFileTreePanel: ComponentType<WorkspaceFileTreePanelProps>;
  CodeOpenInMenu: ComponentType;
  UpdateButton: ComponentType<DesktopUpdateButtonProps>;
  ProjectsSidebar: ComponentType<DesktopProjectsSidebarProps>;
  DesktopLocalSection: ComponentType;
  DesktopBrowserUseSection: ComponentType;
  DesktopComputerUseSection: ComponentType;
  DesktopAppshotsSection: ComponentType;
  DesktopEnvironmentsSection: ComponentType;
  DesktopWorktreesSection: ComponentType;
  PairingSections: ComponentType;
  disableConsoleLogs(): void;
  useBrowserPreview(_desktopRuntime: boolean): DesktopBrowserPreviewState;
  useCompanionPet(_desktopRuntime: boolean): AppServerPetState | null;
  useMenuActions(_options: DesktopMenuActionsOptions): void;
  useShellActions(_platformRuntime: string): DesktopShellActions;
  useRealtimeVoiceSession(_options: {
    setErrorMessage: (_message: string) => void;
  }): DesktopRealtimeVoiceSession;
}

const NullComponent = () => null;
const noop = () => undefined;

const browserFallback: DesktopUiIntegration = {
  AgentManagerPanel: NullComponent,
  Companion: NullComponent,
  CodeWorkspaceSurface: NullComponent,
  AuthButtons: NullComponent,
  BrowserPanel: NullComponent,
  TerminalPanel: NullComponent,
  WorkspaceFileTreePanel: NullComponent,
  CodeOpenInMenu: NullComponent,
  UpdateButton: NullComponent,
  ProjectsSidebar: NullComponent,
  DesktopLocalSection: NullComponent,
  DesktopBrowserUseSection: NullComponent,
  DesktopComputerUseSection: NullComponent,
  DesktopAppshotsSection: NullComponent,
  DesktopEnvironmentsSection: NullComponent,
  DesktopWorktreesSection: NullComponent,
  PairingSections: NullComponent,
  disableConsoleLogs: noop,
  useBrowserPreview: () => ({
    closeBrowserPreview: noop,
    isBrowserPreviewOpen: false,
    openBrowserPreview: noop,
  }),
  useCompanionPet: () => null,
  useMenuActions: noop,
  useShellActions: () => ({
    availableUpdate: null,
    desktopUpdateAction: 'idle',
    desktopUpdateMessage: null,
  }),
  useRealtimeVoiceSession: () => ({
    connect: async () => undefined,
    disconnect: noop,
    endedDurationMs: null,
    isActive: false,
    isCapturing: false,
    isPlaying: false,
    messages: [],
    prewarm: noop,
    status: 'disconnected',
  }),
};

let desktopUi: DesktopUiIntegration = browserFallback;

export const configureDesktopUi = (integration: DesktopUiIntegration): void => {
  desktopUi = integration;
};

export const DesktopAgentManagerPanel = (props: DesktopAgentManagerPanelProps) => (
  <desktopUi.AgentManagerPanel {...props} />
);
export const DesktopCompanion = (props: DesktopCompanionProps) => (
  <desktopUi.Companion {...props} />
);
export const DesktopCodeWorkspaceSurface = (props: DesktopCodeWorkspaceSurfaceProps) => (
  <desktopUi.CodeWorkspaceSurface {...props} />
);
export const DesktopAuthButtons = (props: DesktopAuthButtonsProps) => (
  <desktopUi.AuthButtons {...props} />
);
export const DesktopBrowserPanel = (props: DesktopBrowserPanelProps) => (
  <desktopUi.BrowserPanel {...props} />
);
export const DesktopTerminalPanel = (props: DesktopTerminalPanelProps) => (
  <desktopUi.TerminalPanel {...props} />
);
export const WorkspaceFileTreePanel = (props: WorkspaceFileTreePanelProps) => (
  <desktopUi.WorkspaceFileTreePanel {...props} />
);
export const DesktopCodeOpenInMenu = () => <desktopUi.CodeOpenInMenu />;
export const DesktopUpdateButton = (props: DesktopUpdateButtonProps) => (
  <desktopUi.UpdateButton {...props} />
);
export const DesktopProjectsSidebar = (props: DesktopProjectsSidebarProps) => (
  <desktopUi.ProjectsSidebar {...props} />
);
export const DesktopLocalSection = () => <desktopUi.DesktopLocalSection />;
export const DesktopBrowserUseSection = () => <desktopUi.DesktopBrowserUseSection />;
export const DesktopComputerUseSection = () => <desktopUi.DesktopComputerUseSection />;
export const DesktopAppshotsSection = () => <desktopUi.DesktopAppshotsSection />;
export const DesktopEnvironmentsSection = () => <desktopUi.DesktopEnvironmentsSection />;
export const DesktopWorktreesSection = () => <desktopUi.DesktopWorktreesSection />;
export const PairingSections = () => <desktopUi.PairingSections />;

export const disableDesktopConsoleLogs = (): void => desktopUi.disableConsoleLogs();
export const useDesktopBrowserPreview = (desktopRuntime: boolean): DesktopBrowserPreviewState =>
  desktopUi.useBrowserPreview(desktopRuntime);
export const useDesktopCompanionPet = (desktopRuntime: boolean): AppServerPetState | null =>
  desktopUi.useCompanionPet(desktopRuntime);
export const useDesktopMenuActions = (options: DesktopMenuActionsOptions): void =>
  desktopUi.useMenuActions(options);
export const useDesktopShellActions = (platformRuntime: string): DesktopShellActions =>
  desktopUi.useShellActions(platformRuntime);
export const useDesktopRealtimeVoiceSession = (options: {
  setErrorMessage: (_message: string) => void;
}): DesktopRealtimeVoiceSession => desktopUi.useRealtimeVoiceSession(options);
