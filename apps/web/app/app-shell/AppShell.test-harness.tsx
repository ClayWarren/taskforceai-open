import { act, cleanup, render } from '@testing-library/react';
import { vi } from 'bun:test';
import path from 'path';
import { useCallback, useEffect, useState } from 'react';

import '../../../../tests/setup/dom';
import { installWebBunComponentMocks } from '../../../../tests/setup/web-bun-component-mocks';

installWebBunComponentMocks();

const appPath = (p: string) => path.resolve(process.cwd(), 'apps/web/app', p);

export const routerPushMock = vi.fn();
export const routerNavigateMock = vi.fn();
export const getSignInUrlMock = vi.fn(() => '/api/v1/auth/login?callbackUrl=%2F');
export const chatViewSpy = vi.fn();
export const appPromptComposerSpy = vi.fn();
export const streamingStoreResetMock = vi.fn();
export const invokeTauriMock = vi.fn(
  async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => undefined
);
export const waitForTauriBridgeMock = vi.fn(async () => false);
export const listenTauriEventMock = vi.fn(
  async (event: string, handler: () => void): Promise<() => void> => {
    tauriEventHandlers.set(event, handler);
    return () => {
      tauriEventHandlers.delete(event);
    };
  }
);
export const useStreamingMessagesMock = vi.fn(() => ({
  resetStreamingState: vi.fn(),
}));

export const appShellTestState = {
  platformRuntime: 'browser' as 'browser' | 'desktop',
};

export type PromptDraftTestWindow = Window &
  typeof globalThis & {
    __TASKFORCEAI_PROMPT_DRAFT__?: unknown;
    __TASKFORCEAI_LATENCY_MARK__?: unknown;
  };

const useLocationMock = vi.fn();
const tauriEventHandlers = new Map<string, () => void>();

void vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: any) => <a href={String(to ?? '#')}>{children}</a>,
  useLocation: useLocationMock,
  useNavigate: () => routerNavigateMock,
  useSearch: () => ({}),
}));

void vi.mock(appPath('lib/providers/AuthProvider'), () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    isLoading: false,
    user: { email: 'test@example.com' },
  })),
}));

void vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: getSignInUrlMock,
  },
}));

void vi.mock(appPath('components/routing'), () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({
    push: routerPushMock,
    navigate: routerNavigateMock,
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

void vi.mock(appPath('lib/platform/PlatformProvider'), () => ({
  PlatformProvider: ({ children }: any) => children,
  useConversationStore: vi.fn(),
  useStreamingRuntime: vi.fn(),
  usePlatformRuntime: vi.fn(() => appShellTestState.platformRuntime),
  useStorageAdapter: vi.fn(() => ({
    getSession: vi.fn(async () => ({
      ok: true,
      value: { accessToken: 'test' },
    })),
    getPendingChanges: vi.fn(async () => []),
    getDeviceId: vi.fn(async () => 'test-device'),
    getLastSyncVersion: vi.fn(async () => 0),
  })),
}));

void vi.mock(appPath('lib/platform/desktop-api'), () => ({
  DESKTOP_APP_SERVER_AUTH_CHANGED_EVENT: 'taskforceai:desktop-auth-changed',
  dispatchDesktopAppServerAuthChanged: () =>
    window.dispatchEvent(new Event('taskforceai:desktop-auth-changed')),
  disableDesktopLocalCoding: () => invokeTauriMock('app_server_disable_local_coding'),
  enableDesktopLocalCoding: (params: Record<string, unknown> = {}) =>
    invokeTauriMock('app_server_enable_local_coding', { params }),
  getDesktopAppServerAuthStatus: () => invokeTauriMock('app_server_auth_status'),
  openDesktopExternalUrl: (url: string) => invokeTauriMock('open_external_url', { url }),
  pollDesktopAppServerDeviceLogin: (deviceCode: string) =>
    invokeTauriMock('app_server_auth_device_poll', { deviceCode }),
  startDesktopAppServerDeviceLogin: () => invokeTauriMock('app_server_auth_device_start'),
  invokeTauri: invokeTauriMock,
  waitForTauriBridge: waitForTauriBridgeMock,
}));

void vi.mock(appPath('lib/projects/ProjectsContext'), () => ({
  ProjectsProvider: ({ children }: any) => children,
  useProjects: vi.fn(() => ({
    projects: [],
    activeProjectId: null,
    setActiveProjectId: vi.fn(),
    isLoading: false,
    isModalOpen: false,
    setModalOpen: vi.fn(),
    refreshProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  })),
}));

void vi.mock(appPath('lib/profile/modal/ProfileModalContext'), () => ({
  useProfileModal: vi.fn(() => ({ open: vi.fn() })),
}));

void vi.mock(appPath('lib/hooks/useConversationState'), () => ({
  useConversationState: vi.fn(() => ({
    conversationId: 'test-conv',
    messages: [{ id: '1', role: 'user', content: 'test' }],
    handleNewChat: vi.fn(),
    loadConversation: vi.fn(),
    addUserMessage: vi.fn(),
    ensureActiveConversation: vi.fn(),
    updateToRemoteConversation: vi.fn(),
    setMessages: vi.fn(),
    isInitialized: true,
  })),
}));

void vi.mock(appPath('lib/hooks/usePendingPrompts'), () => ({
  usePendingPrompts: vi.fn(),
}));

void vi.mock(appPath('lib/hooks/usePrefetch'), () => ({
  usePrefetch: vi.fn(),
}));

void vi.mock(appPath('lib/hooks/useSyncManager'), () => ({
  useSyncManager: vi.fn(),
}));

void vi.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: () => false,
}));

void vi.mock('@taskforceai/react-core/useVoice', () => ({
  useVoice: vi.fn(() => ({
    manager: {
      init: vi.fn(),
      speak: vi.fn(),
      cancel: vi.fn(),
      listen: vi.fn(),
    },
    status: 'idle',
    error: null,
  })),
}));

void vi.mock(appPath('lib/hooks/useStreamingMessages'), () => ({
  useStreamingMessages: useStreamingMessagesMock,
}));

void vi.mock(appPath('lib/providers/StreamingProvider'), () => ({
  useStreaming: () => ({
    isStreaming: false,
    errorMessage: null,
    rateLimitResetTime: null,
    finalResponse: null,
    clearErrorMessage: vi.fn(),
    streamContent: '',
    startStreaming: vi.fn(),
    setErrorMessage: vi.fn(),
    sources: [],
    finalSources: [],
    toolEvents: [],
    finalToolEvents: [],
    elapsedSeconds: 0,
    agentStatuses: [],
    trace_id: null,
    pendingApproval: null,
    computerUseEnabled: false,
    useLoggedInServices: false,
    reset: streamingStoreResetMock,
  }),
  StreamingProvider: ({ children }: any) => children,
}));

void vi.mock(appPath('lib/mcp/useMcpToolCatalog'), () => ({
  useWebMcpToolCatalog: vi.fn(() => ({
    manager: { closeAll: vi.fn(async () => undefined) },
    snapshot: { toolSummary: null, items: [] },
  })),
}));

void vi.mock(appPath('components/shell/OfflineIndicator'), () => ({
  __esModule: true,
  default: () => <div data-testid="offline-indicator" />,
}));

void vi.mock(appPath('components/chat/ConversationList'), () => ({
  __esModule: true,
  default: () => <div data-testid="conversation-list" />,
}));

void vi.mock(appPath('components/shell/Sidebar'), () => ({
  __esModule: true,
  default: ({ desktopUpdateMessage, onOpenReportIssue }: any) => (
    <div data-testid="sidebar">
      {desktopUpdateMessage ? (
        <div data-testid="desktop-update-message">{desktopUpdateMessage}</div>
      ) : null}
      <button onClick={onOpenReportIssue}>Report issue</button>
    </div>
  ),
}));

void vi.mock(appPath('components/chat/PendingPrompts'), () => ({
  __esModule: true,
  default: () => <div data-testid="pending-prompts" />,
}));

void vi.mock(appPath('app-shell/navigation/CollapsedSidebar'), () => ({
  __esModule: true,
  CollapsedSidebar: ({
    onNewChat,
    onLogoClick,
    onSearchClick,
    onOpenProfile,
    onOpenReportIssue,
    onOpenBrowserPreview,
    onShowTerminal,
    onCheckForUpdates,
  }: any) => (
    <div data-testid="collapsed-sidebar" style={{ display: 'block' }}>
      <button onClick={onNewChat}>NewCol</button>
      <button onClick={onLogoClick}>Logo</button>
      <button onClick={onSearchClick} data-testid="search-btn">
        Search
      </button>
      {onShowTerminal ? (
        <button onClick={onShowTerminal} data-testid="show-terminal-btn">
          Terminal
        </button>
      ) : null}
      {onOpenBrowserPreview ? (
        <button onClick={onOpenBrowserPreview} data-testid="open-browser-preview-btn">
          Browser
        </button>
      ) : null}
      {onCheckForUpdates ? (
        <button onClick={onCheckForUpdates} data-testid="check-updates-btn">
          Updates
        </button>
      ) : null}
      <button onClick={onOpenProfile}>Profile</button>
      {onOpenReportIssue ? <button onClick={onOpenReportIssue}>Report issue</button> : null}
    </div>
  ),
}));

void vi.mock(appPath('app-shell/chat/ChatView'), () => ({
  __esModule: true,
  ChatView: (props: any) => {
    chatViewSpy(props);
    return (
      <div data-testid="chat-view">
        <button onClick={props.onShare}>OpenShare</button>
      </div>
    );
  },
}));

void vi.mock(appPath('app-shell/chat/AppPromptComposer'), () => ({
  __esModule: true,
  AppPromptComposer: (props: any) => {
    appPromptComposerSpy(props);
    return <div data-testid={`prompt-form-${props.variant}`}>{props.variant}</div>;
  },
}));

void vi.mock(appPath('components/modals/ReportIssueModal'), () => ({
  __esModule: true,
  default: ({ open }: any) => (open ? <div data-testid="report-issue-modal" /> : null),
}));

void vi.mock(appPath('components/modals/QuickSearchDialog'), () => ({
  __esModule: true,
  QuickSearchDialog: ({ isOpen, onSelect }: any) => {
    useEffect(() => {
      if (isOpen) {
        onSelect({
          conversationId: '123',
          updatedAt: new Date().toISOString(),
          title: 'Mock title',
        });
      }
    }, [isOpen, onSelect]);
    return isOpen ? <div data-testid="quick-search-dialog" /> : null;
  },
}));

void vi.mock(appPath('components/chat/ShareModal'), () => ({
  __esModule: true,
  default: ({ conversationId, isOpen }: any) => (
    <div data-testid="share-modal">{`${conversationId}:${String(isOpen)}`}</div>
  ),
}));

void vi.mock(appPath('lib/platform/desktop-ui'), () => ({
  DesktopAgentManagerPanel: () => null,
  DesktopAuthButtons: ({ onSignIn }: any) => <button onClick={onSignIn}>DesktopSignIn</button>,
  DesktopTerminalPanel: ({ open }: any) =>
    open ? <div aria-label="Desktop terminal" data-testid="desktop-terminal" /> : null,
  DesktopBrowserPanel: ({ open, onClose }: any) =>
    open ? (
      <aside aria-label="Desktop browser">
        <button type="button" onClick={onClose}>
          Close browser
        </button>
      </aside>
    ) : null,
  DesktopCompanion: () => null,
  DesktopCodeOpenInMenu: () => null,
  DesktopCodeWorkspaceSurface: () => null,
  DesktopProjectsSidebar: () => null,
  DesktopUpdateButton: ({ desktopUpdateVersion }: { desktopUpdateVersion: string }) => (
    <button type="button">Update {desktopUpdateVersion}</button>
  ),
  WorkspaceFileTreePanel: () => null,
  DESKTOP_CODE_WORKSPACE_PANE_WIDTH: 'min(68vw, 1180px)',
  disableDesktopConsoleLogs: () => undefined,
  useDesktopBrowserPreview: (desktopRuntime: boolean) => {
    const [isBrowserPreviewOpen, setIsBrowserPreviewOpen] = useState(false);
    useEffect(() => {
      if (!desktopRuntime) setIsBrowserPreviewOpen(false);
    }, [desktopRuntime]);
    const openBrowserPreview = useCallback(() => {
      if (desktopRuntime) setIsBrowserPreviewOpen(true);
    }, [desktopRuntime]);
    const closeBrowserPreview = useCallback(() => setIsBrowserPreviewOpen(false), []);
    useEffect(() => {
      if (!desktopRuntime) return;
      const handleClick = (event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest<HTMLAnchorElement>('a[href]');
        const href = anchor?.href;
        if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return;
        event.preventDefault();
        setIsBrowserPreviewOpen(true);
        void invokeTauriMock('desktop_browser_open', { params: { url: href } });
      };
      document.addEventListener('click', handleClick, true);
      return () => document.removeEventListener('click', handleClick, true);
    }, [desktopRuntime]);
    return { closeBrowserPreview, isBrowserPreviewOpen, openBrowserPreview };
  },
  useDesktopCompanionPet: (desktopRuntime: boolean) => {
    const [pet, setPet] = useState<unknown>(null);
    useEffect(() => {
      if (!desktopRuntime) {
        setPet(null);
        return;
      }
      void invokeTauriMock('app_server_status_summary').then((status: any) =>
        setPet(status?.pet ?? null)
      );
    }, [desktopRuntime]);
    return pet;
  },
  useDesktopMenuActions: ({
    desktopRuntime,
    onCheckForUpdates,
    onOpenBrowserPreview,
    onOpenSettings,
  }: any) => {
    useEffect(() => {
      if (!desktopRuntime) return;
      const unlisteners: Array<() => void> = [];
      void Promise.all([
        listenTauriEventMock('desktop-menu:settings', onOpenSettings),
        listenTauriEventMock('desktop-menu:check-for-updates', () => onCheckForUpdates?.()),
        listenTauriEventMock('desktop-menu:browser-preview', onOpenBrowserPreview),
      ]).then((values) => unlisteners.push(...values));
      return () => unlisteners.forEach((unlisten) => unlisten());
    }, [desktopRuntime, onCheckForUpdates, onOpenBrowserPreview, onOpenSettings]);
  },
  useDesktopShellActions: (platformRuntime: string) => {
    const [availableUpdate, setAvailableUpdate] = useState<any>(null);
    const [desktopUpdateMessage, setDesktopUpdateMessage] = useState<string | null>(null);
    const check = useCallback(async () => {
      const update: any = await invokeTauriMock('desktop_update_check');
      setAvailableUpdate(update?.available && update?.version ? update : null);
      if (!update?.available || !update?.version) {
        setDesktopUpdateMessage(`TaskForceAI is up to date (${update?.currentVersion}).`);
      }
    }, []);
    useEffect(() => {
      if (platformRuntime !== 'desktop') return;
      void invokeTauriMock('app_server_initialize');
      const timeout = window.setTimeout(() => void check(), 3000);
      return () => window.clearTimeout(timeout);
    }, [check, platformRuntime]);
    return {
      availableUpdate: platformRuntime === 'desktop' ? availableUpdate : null,
      desktopUpdateAction: 'idle',
      desktopUpdateMessage: platformRuntime === 'desktop' ? desktopUpdateMessage : null,
      handleCheckForUpdates: platformRuntime === 'desktop' ? () => void check() : undefined,
    };
  },
}));

export let useConversationState: typeof import('../lib/hooks/useConversationState').useConversationState;
export let useAuth: typeof import('../lib/providers/AuthProvider').useAuth;
export let useProfileModal: typeof import('../lib/profile/modal/ProfileModalContext').useProfileModal;
export let AppShell: typeof import('./AppShell').AppShell;

const createConversationStateMock = (overrides: Record<string, unknown> = {}) => ({
  conversationId: 'test-conv',
  messages: [{ id: '1', role: 'user', content: 'test' }],
  handleNewChat: vi.fn(),
  loadConversation: vi.fn(),
  addUserMessage: vi.fn(),
  ensureActiveConversation: vi.fn(),
  updateToRemoteConversation: vi.fn(),
  setMessages: vi.fn(),
  isInitialized: true,
  ...overrides,
});

export const loadAppShellTestModules = async () => {
  ({ useConversationState } = await import('../lib/hooks/useConversationState'));
  ({ useAuth } = await import('../lib/providers/AuthProvider'));
  ({ useProfileModal } = await import('../lib/profile/modal/ProfileModalContext'));
  ({ AppShell } = await import('./AppShell'));
};

export async function renderAppShell() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<AppShell />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
}

export const mockConversationState = (overrides: Record<string, unknown> = {}) => {
  (useConversationState as any).mockReturnValue(createConversationStateMock(overrides));
};

export const mockUnauthenticated = (isLoading = false) => {
  (useAuth as any).mockReturnValue({
    isAuthenticated: false,
    isLoading,
    user: null,
  });
};

export const resetDefaultMocks = () => {
  (useAuth as any).mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    user: { email: 'test@example.com' },
  });
  (useProfileModal as any).mockReturnValue({ open: vi.fn() });
  mockConversationState();
  useStreamingMessagesMock.mockReturnValue({
    resetStreamingState: vi.fn(),
  });
  invokeTauriMock.mockImplementation(async () => undefined);
  getSignInUrlMock.mockReturnValue('/api/v1/auth/login?callbackUrl=%2F');
};

export const mockDeviceLoginCommands = (withStatusSummary = false) => {
  invokeTauriMock.mockImplementation(async (command: string) => {
    if (withStatusSummary && command === 'app_server_status_summary') return { pet: null };
    if (command === 'app_server_auth_status') return { authenticated: true };
    if (command === 'app_server_auth_device_start') {
      return {
        deviceCode: 'device-code-1',
        userCode: 'ABCD-1234',
        verificationUri: 'https://auth.taskforceai.chat/device',
        verificationUriComplete: 'https://auth.taskforceai.chat/device?user_code=ABCD-1234',
        expiresIn: 600,
        interval: 60,
      };
    }
    if (command === 'app_server_auth_device_poll') return { status: 'approved', token: 'token' };
    return undefined;
  });
};

export const emitDesktopMenuEvent = async (event: string) => {
  await act(async () => {
    tauriEventHandlers.get(event)?.();
    await Promise.resolve();
    await Promise.resolve();
  });
};

export const resetAppShellTestHarness = async () => {
  await loadAppShellTestModules();
  vi.clearAllMocks();
  resetDefaultMocks();
  tauriEventHandlers.clear();
  waitForTauriBridgeMock.mockResolvedValue(false);
  appShellTestState.platformRuntime = 'browser';
  window.innerWidth = 1280;
  window.dispatchEvent(new Event('resize'));
  useLocationMock.mockReturnValue({
    pathname: '/',
    search: {},
    hash: '',
    state: {},
    key: 'key',
    href: '/',
    deprecated_state: {},
    maskedLocation: undefined,
  } as any);
};

export const cleanupAppShellTestHarness = () => {
  cleanup();
  delete (window as PromptDraftTestWindow).__TASKFORCEAI_PROMPT_DRAFT__;
  delete (window as PromptDraftTestWindow).__TASKFORCEAI_LATENCY_MARK__;
};
