import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import path from 'path';
import { useEffect } from 'react';

import '../../../../tests/setup/dom';
import { installWebBunComponentMocks } from '../../../../tests/setup/web-bun-component-mocks';

installWebBunComponentMocks();

const appPath = (p: string) => path.resolve(process.cwd(), 'apps/web/app', p);
const routerPushMock = vi.fn();
const routerNavigateMock = vi.fn();
const getSignInUrlMock = vi.fn(() => '/api/v1/auth/login?callbackUrl=%2F');
const chatViewSpy = vi.fn();
const appPromptComposerSpy = vi.fn();
const useLocationMock = vi.fn();
const streamingStoreResetMock = vi.fn();
const invokeTauriMock = vi.fn(async (_command: string): Promise<unknown> => undefined);
const waitForTauriBridgeMock = vi.fn(async () => false);
const listenTauriEventMock = vi.fn(
  async (event: string, handler: () => void): Promise<() => void> => {
    tauriEventHandlers.set(event, handler);
    return () => {
      tauriEventHandlers.delete(event);
    };
  }
);
const tauriEventHandlers = new Map<string, () => void>();
let platformRuntimeMock: 'browser' | 'desktop' = 'browser';
const useStreamingMessagesMock = vi.fn(() => ({
  resetStreamingState: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: any) => <a href={String(to ?? '#')}>{children}</a>,
  useLocation: useLocationMock,
  useNavigate: () => routerNavigateMock,
  useSearch: () => ({}),
}));

vi.mock(appPath('lib/providers/AuthProvider'), () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    isLoading: false,
    user: { email: 'test@example.com' },
  })),
}));

vi.mock('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: getSignInUrlMock,
  },
}));

vi.mock(appPath('components/routing'), () => ({
  usePathname: vi.fn(() => '/'),
  useRouter: vi.fn(() => ({
    push: routerPushMock,
    navigate: routerNavigateMock,
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock(appPath('lib/platform/PlatformProvider'), () => ({
  PlatformProvider: ({ children }: any) => children,
  useConversationStore: vi.fn(),
  useStreamingRuntime: vi.fn(),
  usePlatformRuntime: vi.fn(() => platformRuntimeMock),
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

vi.mock(appPath('lib/platform/desktop/bridge'), () => ({
  invokeTauri: invokeTauriMock,
  listenTauriEvent: listenTauriEventMock,
  waitForTauriBridge: waitForTauriBridgeMock,
}));

vi.mock(appPath('lib/projects/ProjectsContext'), () => ({
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

vi.mock(appPath('lib/profile/ProfileModalContext'), () => ({
  useProfileModal: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock(appPath('lib/hooks/useConversationState'), () => ({
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

vi.mock(appPath('lib/hooks/usePendingPrompts'), () => ({
  usePendingPrompts: vi.fn(),
}));

vi.mock(appPath('lib/hooks/usePrefetch'), () => ({
  usePrefetch: vi.fn(),
}));

vi.mock(appPath('lib/hooks/useSyncManager'), () => ({
  useSyncManager: vi.fn(),
}));

vi.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: () => false,
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

vi.mock(appPath('lib/hooks/useStreamingMessages'), () => ({
  useStreamingMessages: useStreamingMessagesMock,
}));

vi.mock(appPath('lib/providers/StreamingProvider'), () => ({
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

vi.mock(appPath('lib/mcp/useMcpToolCatalog'), () => ({
  useWebMcpToolCatalog: vi.fn(() => ({
    manager: { closeAll: vi.fn(async () => undefined) },
    snapshot: { toolSummary: null, items: [] },
  })),
}));

vi.mock(appPath('components/shell/OfflineIndicator'), () => ({
  __esModule: true,
  default: () => <div data-testid="offline-indicator" />,
}));

vi.mock(appPath('components/chat/ConversationList'), () => ({
  __esModule: true,
  default: () => <div data-testid="conversation-list" />,
}));

vi.mock(appPath('components/shell/Sidebar'), () => ({
  __esModule: true,
  default: ({ onOpenReportIssue }: any) => (
    <div data-testid="sidebar">
      <button onClick={onOpenReportIssue}>Report issue</button>
    </div>
  ),
}));

vi.mock(appPath('components/chat/PendingPrompts'), () => ({
  __esModule: true,
  default: () => <div data-testid="pending-prompts" />,
}));

vi.mock(appPath('app-shell/CollapsedSidebar'), () => ({
  __esModule: true,
  CollapsedSidebar: ({
    onNewChat,
    onLogoClick,
    onSearchClick,
    onOpenProfile,
    onOpenReportIssue,
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

vi.mock(appPath('app-shell/ChatView'), () => ({
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

vi.mock('./AppPromptComposer', () => ({
  __esModule: true,
  AppPromptComposer: (props: any) => {
    appPromptComposerSpy(props);
    return <div data-testid={`prompt-form-${props.variant}`}>{props.variant}</div>;
  },
}));

vi.mock(appPath('components/modals/ReportIssueModal'), () => ({
  __esModule: true,
  default: ({ open }: any) => (open ? <div data-testid="report-issue-modal" /> : null),
}));

vi.mock(appPath('components/modals/QuickSearchDialog'), () => ({
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

vi.mock(appPath('components/chat/ShareModal'), () => ({
  __esModule: true,
  default: ({ conversationId, isOpen }: any) => (
    <div data-testid="share-modal">{`${conversationId}:${String(isOpen)}`}</div>
  ),
}));

vi.mock(appPath('app-shell/DesktopAuthButtons'), () => ({
  __esModule: true,
  DesktopAuthButtons: ({ onSignIn }: any) => <button onClick={onSignIn}>DesktopSignIn</button>,
}));

vi.mock(appPath('app-shell/DesktopTerminalPanel'), () => ({
  __esModule: true,
  DesktopTerminalPanel: ({ open }: any) =>
    open ? <div aria-label="Desktop terminal" data-testid="desktop-terminal" /> : null,
}));

let useConversationState: typeof import('../lib/hooks/useConversationState').useConversationState;
let useAuth: typeof import('../lib/providers/AuthProvider').useAuth;
let useProfileModal: typeof import('../lib/profile/ProfileModalContext').useProfileModal;
let AppShell: typeof import('./AppShell').AppShell;

const mockUseLocation = useLocationMock;

async function renderAppShell() {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<AppShell />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return result as ReturnType<typeof render>;
}

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

const mockConversationState = (overrides: Record<string, unknown> = {}) => {
  (useConversationState as any).mockReturnValue(createConversationStateMock(overrides));
};

const mockUnauthenticated = (isLoading = false) => {
  (useAuth as any).mockReturnValue({
    isAuthenticated: false,
    isLoading,
    user: null,
  });
};

const resetDefaultMocks = () => {
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

const mockDeviceLoginCommands = (withStatusSummary = false) => {
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

const emitDesktopMenuEvent = async (event: string) => {
  await act(async () => {
    tauriEventHandlers.get(event)?.();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(async () => {
    ({ useConversationState } = await import('../lib/hooks/useConversationState'));
    ({ useAuth } = await import('../lib/providers/AuthProvider'));
    ({ useProfileModal } = await import('../lib/profile/ProfileModalContext'));
    ({ AppShell } = await import('./AppShell'));
    vi.clearAllMocks();
    resetDefaultMocks();
    tauriEventHandlers.clear();
    waitForTauriBridgeMock.mockResolvedValue(false);
    platformRuntimeMock = 'browser';
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));
    mockUseLocation.mockReturnValue({
      pathname: '/',
      search: {},
      hash: '',
      state: {},
      key: 'key',
      href: '/',
      deprecated_state: {},
      maskedLocation: undefined,
    } as any);
  });

  it('renders main layout components', async () => {
    await renderAppShell();
    expect(screen.getByTestId('chat-view')).toBeTruthy();
  });

  it('renders current sidebar actions', async () => {
    await renderAppShell();
    expect(screen.getByTestId('search-btn')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('routes to home on logo click and resets state on new chat', async () => {
    const mockHandleNewChat = vi.fn();
    const resetStreamingState = vi.fn();
    mockConversationState({
      handleNewChat: mockHandleNewChat,
    });
    useStreamingMessagesMock.mockReturnValue({
      resetStreamingState,
    });

    await renderAppShell();
    fireEvent.click(screen.getByText('Logo'));
    fireEvent.click(screen.getByText('NewCol'));

    expect(routerPushMock).toHaveBeenCalledWith('/');
    expect(mockHandleNewChat).toHaveBeenCalled();
    expect(streamingStoreResetMock).toHaveBeenCalled();
    expect(resetStreamingState).toHaveBeenCalled();
  });

  it('handles report issue modal', async () => {
    await renderAppShell();
    act(() => {
      fireEvent.click(screen.getByText('Report issue'));
    });
    expect(screen.getByTestId('report-issue-modal')).toBeTruthy();
  });

  it('handles quick search', async () => {
    const mockLoadConv = vi.fn();
    const resetStreamingState = vi.fn();
    mockConversationState({
      loadConversation: mockLoadConv,
    });
    useStreamingMessagesMock.mockReturnValue({
      resetStreamingState,
    });

    await renderAppShell();
    await act(async () => {
      fireEvent.click(screen.getByTestId('search-btn'));
    });

    expect(mockLoadConv).toHaveBeenCalled();
    expect(resetStreamingState).toHaveBeenCalled();
  });

  it('shows desktop terminal button only in desktop runtime', async () => {
    const { rerender } = await renderAppShell();
    expect(screen.queryByTestId('show-terminal-btn')).toBeNull();
    expect(screen.queryByLabelText('Desktop terminal')).toBeNull();

    platformRuntimeMock = 'desktop';
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('show-terminal-btn'));

    expect(screen.getByLabelText('Desktop terminal')).toBeTruthy();
    expect(invokeTauriMock).not.toHaveBeenCalledWith('show_terminal');
  });

  it('checks for desktop updates in desktop runtime', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    invokeTauriMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_update_check') {
        return {
          available: false,
          currentVersion: '0.4.1',
          version: null,
        };
      }
      return { pet: null };
    });

    const { rerender } = await renderAppShell();
    expect(screen.queryByTestId('check-updates-btn')).toBeNull();

    platformRuntimeMock = 'desktop';
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('check-updates-btn'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(invokeTauriMock).toHaveBeenCalledWith('desktop_update_check');
    expect(window.alert).toHaveBeenCalledWith('TaskForceAI is up to date (0.4.1).');
  });

  it('opens settings from the desktop app menu', async () => {
    const mockOpen = vi.fn();
    (useProfileModal as any).mockReturnValue({ open: mockOpen });
    platformRuntimeMock = 'desktop';

    await renderAppShell();
    await emitDesktopMenuEvent('desktop-menu:settings');

    expect(listenTauriEventMock).toHaveBeenCalledWith(
      'desktop-menu:settings',
      expect.any(Function)
    );
    expect(mockOpen).toHaveBeenCalled();
  });

  it('checks for updates from the desktop app menu', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    invokeTauriMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_update_check') {
        return {
          available: false,
          currentVersion: '0.4.1',
          version: null,
        };
      }
      return { pet: null };
    });
    platformRuntimeMock = 'desktop';

    await renderAppShell();
    await emitDesktopMenuEvent('desktop-menu:check-for-updates');

    expect(listenTauriEventMock).toHaveBeenCalledWith(
      'desktop-menu:check-for-updates',
      expect.any(Function)
    );
    expect(invokeTauriMock).toHaveBeenCalledWith('desktop_update_check');
    expect(window.alert).toHaveBeenCalledWith('TaskForceAI is up to date (0.4.1).');
  });

  it('surfaces available desktop updates after startup check', async () => {
    vi.useFakeTimers();
    invokeTauriMock.mockImplementation(async (command: string) => {
      if (command === 'desktop_update_check') {
        return {
          available: true,
          currentVersion: '0.4.8',
          version: '0.4.9',
        };
      }
      return { pet: null };
    });

    platformRuntimeMock = 'desktop';
    await renderAppShell();
    expect(screen.queryByText('Update 0.4.9')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText('Update 0.4.9').length).toBeGreaterThan(0);
  });

  it('handles profile opening', async () => {
    const mockOpen = vi.fn();
    (useProfileModal as any).mockReturnValue({ open: mockOpen });
    await renderAppShell();
    act(() => {
      fireEvent.click(screen.getByText('Profile'));
    });
    expect(mockOpen).toHaveBeenCalled();
  });

  it('does not open profile modal when not authenticated', async () => {
    const mockOpen = vi.fn();
    mockUnauthenticated();
    (useProfileModal as any).mockReturnValue({ open: mockOpen });

    await renderAppShell();
    fireEvent.click(screen.getByText('Profile'));

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('uses browser auth redirect outside the desktop runtime', async () => {
    mockUnauthenticated();
    mockConversationState({
      conversationId: null,
      messages: [],
    });

    await renderAppShell();
    await act(async () => {
      fireEvent.click(screen.getByText('DesktopSignIn'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSignInUrlMock).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  it('uses device login when the Tauri bridge is ready before runtime promotion', async () => {
    waitForTauriBridgeMock.mockResolvedValue(true);
    mockDeviceLoginCommands();
    mockUnauthenticated();
    mockConversationState({
      conversationId: null,
      messages: [],
    });

    await renderAppShell();
    await act(async () => {
      fireEvent.click(screen.getByText('DesktopSignIn'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSignInUrlMock).not.toHaveBeenCalled();
    expect(waitForTauriBridgeMock).toHaveBeenCalledWith(500);
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_auth_device_start');
    expect(invokeTauriMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://auth.taskforceai.chat/device?user_code=ABCD-1234&client=desktop',
    });
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_auth_status');
  });

  it('uses device login for unauthenticated desktop sign-in', async () => {
    platformRuntimeMock = 'desktop';
    mockDeviceLoginCommands(true);
    mockUnauthenticated();
    mockConversationState({
      conversationId: null,
      messages: [],
    });

    await renderAppShell();
    await act(async () => {
      fireEvent.click(screen.getByText('DesktopSignIn'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSignInUrlMock).not.toHaveBeenCalled();
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_auth_device_start');
    expect(invokeTauriMock).toHaveBeenCalledWith('open_external_url', {
      url: 'https://auth.taskforceai.chat/device?user_code=ABCD-1234&client=desktop',
    });
    expect(invokeTauriMock).toHaveBeenCalledWith('app_server_auth_status');
  });

  it('does not render desktop sign-in while auth is loading', async () => {
    mockUnauthenticated(true);
    mockConversationState({
      conversationId: null,
      messages: [],
    });

    await renderAppShell();
    expect(screen.queryByText('DesktopSignIn')).toBeNull();
  });

  it('shows mobile hamburger when viewport is mobile and chat has messages', async () => {
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));
    mockConversationState({
      conversationId: 'conv-mobile',
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    });

    await renderAppShell();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
  });

  it('renders impersonation banner when user is in support mode', async () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: {
        email: 'impersonated@example.com',
        impersonator_id: 'support-user',
      },
    });

    await renderAppShell();
    expect(screen.getByText(/Support Mode: Impersonating impersonated@example.com/)).toBeTruthy();
  });

  it('renders share modal for remote conversations and allows opening share flow', async () => {
    mockConversationState({
      conversationId: 'remote-123',
      isPublic: false,
      shareId: 'share-1',
      messages: [{ id: '1', role: 'assistant', content: 'answer' }],
    });

    await renderAppShell();
    expect(chatViewSpy).toHaveBeenCalledWith(expect.objectContaining({ canShare: true }));
    const shareModal = await screen.findByTestId('share-modal');
    expect(shareModal.textContent).toContain('123:false');

    await act(async () => {
      fireEvent.click(screen.getByText('OpenShare'));
    });

    expect(shareModal.textContent).toContain('123:true');
  });

  it('renders share modal for restored saved conversations with numeric ids', async () => {
    mockConversationState({
      conversationId: '123',
      isPublic: true,
      shareId: 'share-1',
      messages: [{ id: '1', role: 'assistant', content: 'answer' }],
    });

    await renderAppShell();
    expect(chatViewSpy).toHaveBeenCalledWith(expect.objectContaining({ canShare: true }));
    const shareModal = await screen.findByTestId('share-modal');
    expect(shareModal.textContent).toContain('123:false');

    await act(async () => {
      fireEvent.click(screen.getByText('OpenShare'));
    });

    expect(shareModal.textContent).toContain('123:true');
  });

  it('does not enable share for local conversations even when messages exist', async () => {
    mockConversationState({
      conversationId: 'local-123',
      isPublic: false,
      shareId: null,
      messages: [{ id: '1', role: 'assistant', content: 'answer' }],
    });

    await renderAppShell();
    expect(chatViewSpy).toHaveBeenCalledWith(expect.objectContaining({ canShare: false }));
    expect(screen.queryByTestId('share-modal')).toBeNull();
  });

  it('renders centered prompt when no messages and bottom prompt when messages exist', async () => {
    mockConversationState({
      conversationId: null,
      messages: [],
    });

    const { rerender } = await renderAppShell();
    expect(screen.getByTestId('prompt-form-centered')).toBeTruthy();

    mockConversationState({
      conversationId: 'remote-42',
      messages: [{ id: 'm2', role: 'assistant', content: 'done' }],
    });
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('prompt-form-bottom')).toBeTruthy();
  });

  it('keeps empty authenticated prompt usable while conversation state initializes', async () => {
    mockConversationState({
      conversationId: null,
      isInitialized: false,
      messages: [],
    });
    await renderAppShell();
    expect(screen.queryByTestId('chat-view')).toBeNull();
    expect(screen.getByTestId('prompt-form-centered')).toBeTruthy();
    expect(screen.queryByTestId('prompt-form-bottom')).toBeNull();
    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isDisabled: false,
        showPromptLogo: true,
        variant: 'centered',
      })
    );
  });

  it('preserves a draft when conversation restore switches the prompt to the bottom rail', async () => {
    mockConversationState({
      conversationId: null,
      isInitialized: false,
      messages: [],
    });

    const { rerender } = await renderAppShell();
    const centeredCall = appPromptComposerSpy.mock.calls.find(
      ([props]) => props.variant === 'centered'
    );
    expect(centeredCall).toBeTruthy();

    await act(async () => {
      centeredCall?.[0].onPromptValueChange('draft before restore');
      await Promise.resolve();
    });

    mockConversationState({
      conversationId: 'remote-42',
      isInitialized: true,
      messages: [{ id: 'm2', role: 'assistant', content: 'restored' }],
    });
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        promptValue: 'draft before restore',
        variant: 'bottom',
      })
    );
  });

  it('keeps the centered prompt visible while auth is hydrating on new chat', async () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
    });
    mockConversationState({
      isInitialized: false,
      messages: [],
    });

    await renderAppShell();

    expect(screen.queryByTestId('chat-view')).toBeNull();
    expect(screen.getByTestId('prompt-form-centered')).toBeTruthy();
    expect(screen.queryByTestId('prompt-form-bottom')).toBeNull();
  });
});
