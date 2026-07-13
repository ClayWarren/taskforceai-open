import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../tests/setup/dom';

vi.mock('../components/shell/Sidebar', () => ({
  __esModule: true,
  default: ({
    activeConversationId,
    isOpen,
  }: {
    activeConversationId?: string | null;
    isOpen: boolean;
  }) => (
    <aside
      data-active-conversation-id={activeConversationId ?? ''}
      data-testid="sidebar"
      data-open={String(isOpen)}
    />
  ),
}));

vi.mock('./AppPromptComposer', () => ({
  AppPromptComposer: ({
    desktopRightInset,
    onRealtimeVoiceActiveChange,
    variant,
  }: {
    desktopRightInset?: string;
    onRealtimeVoiceActiveChange?: (_isActive: boolean) => void;
    variant: string;
  }) => (
    <form
      aria-label={`Prompt submission form ${variant}`}
      data-desktop-right-inset={desktopRightInset ?? ''}
    >
      <button type="button" onClick={() => onRealtimeVoiceActiveChange?.(true)}>
        Activate voice {variant}
      </button>
    </form>
  ),
}));

vi.mock('./ChatView', () => ({
  ChatView: () => <div data-testid="chat-view" />,
}));

vi.mock('./CollapsedSidebar', () => ({
  CollapsedSidebar: ({
    isSidebarOpen,
    onFileTreeClick,
  }: {
    isSidebarOpen: boolean;
    onFileTreeClick?: () => void;
  }) => (
    <div data-testid="collapsed-sidebar" data-open={String(isSidebarOpen)}>
      {onFileTreeClick ? (
        <button type="button" onClick={onFileTreeClick}>
          Files
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('./DesktopCompanion', () => ({
  DesktopCompanion: () => null,
}));

vi.mock('./DesktopAuthButtons', () => ({
  DesktopAuthButtons: () => null,
}));

vi.mock('./DesktopTerminalPanel', () => ({
  DesktopTerminalPanel: () => null,
}));

vi.mock('./DesktopBrowserPanel', () => ({
  DesktopBrowserPanel: ({
    open,
    width,
    developerModeEnabled,
  }: {
    open: boolean;
    width?: string;
    developerModeEnabled?: boolean;
  }) =>
    open ? (
      <aside
        aria-label="Desktop browser"
        data-width={width ?? ''}
        data-developer-mode={String(Boolean(developerModeEnabled))}
      />
    ) : null,
}));

vi.mock('./WorkspaceFileTreePanel', () => ({
  WorkspaceFileTreePanel: ({
    isOpen,
    onInsertIntoComposer,
  }: {
    isOpen: boolean;
    onInsertIntoComposer: (text: string) => void;
  }) =>
    isOpen ? (
      <button type="button" onClick={() => onInsertIntoComposer('workspace excerpt')}>
        Insert workspace excerpt
      </button>
    ) : null,
}));

vi.mock('./icons', () => ({
  MobileHamburgerIcon: () => <span />,
}));

import { AppShellFrame } from './AppShellFrame';

const noop = vi.fn();

const baseProps = {
  canShareConversation: false,
  conversation: {
    conversationId: 'conversation-id',
    ensureActiveConversation: vi.fn(async () => 'conversation-id'),
    hasMoreMessages: false,
    isInitialized: true,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(async () => undefined),
  },
  errorMessage: null,
  isAuthLoading: false,
  isAuthenticated: true,
  isMobileViewport: false,
  isPromptDisabled: false,
  isPrivateChat: false,
  isPrivateChatToggleDisabled: false,
  isSidebarOpen: false,
  messages: [],
  promptComposerProps: {} as any,
  promptVariant: 'centered' as const,
  rateLimitResetTime: null,
  shouldShowNewChatShortcut: true,
  showMobileHero: false,
  showPromptLogo: true,
  onConversationSelect: noop,
  onHamburgerClick: noop,
  onLogoClick: noop,
  onNewChat: noop,
  onOpenChangelog: noop,
  onOpenProfile: noop,
  onOpenReportIssue: noop,
  onOpenSidebar: noop,
  onSearchClick: noop,
  onTogglePrivateChat: noop,
  onSendMessage: noop,
  onShare: noop,
  onSidebarClose: noop,
  onSignIn: noop,
  clearErrorMessage: noop,
};

describe('AppShellFrame', () => {
  afterEach(() => cleanup());

  it('reserves desktop sidebar width when the sidebar is open', () => {
    const { container } = render(<AppShellFrame {...baseProps} isSidebarOpen />);

    const mainContent = container.querySelector('.main-content');
    expect(mainContent?.className).toContain('md:pl-[20rem]');
    expect(mainContent?.className).toContain('lg:pl-[22rem]');
    expect(mainContent?.className).not.toContain('md:blur');
    expect(screen.getByTestId('sidebar').getAttribute('data-open')).toBe('true');
  });

  it('passes the current conversation id to the sidebar', () => {
    render(<AppShellFrame {...baseProps} />);

    expect(screen.getByTestId('sidebar').getAttribute('data-active-conversation-id')).toBe(
      'conversation-id'
    );
  });

  it('renders the private chat toggle in the top right corner', () => {
    const onTogglePrivateChat = vi.fn();
    render(
      <AppShellFrame {...baseProps} isPrivateChat onTogglePrivateChat={onTogglePrivateChat} />
    );

    const toggle = screen.getByRole('button', {
      name: 'Turn off Private Chat',
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);

    expect(onTogglePrivateChat).toHaveBeenCalledTimes(1);
  });

  it('hides the private chat toggle in Work mode', () => {
    render(<AppShellFrame {...baseProps} desktopTaskMode="work" />);

    expect(screen.queryByRole('button', { name: 'Start Private Chat' })).toBeNull();
  });

  it('exposes workspace editing only in desktop Code mode', () => {
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="work" enableWorkspaceFileTree />
    );
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull();

    rerender(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="chat" enableWorkspaceFileTree />
    );
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull();

    rerender(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" enableWorkspaceFileTree />
    );
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy();
  });

  it('places top-right controls and fixed composers to the left of the desktop browser pane', () => {
    const { container } = render(
      <AppShellFrame {...baseProps} isBrowserPreviewOpen isPrivateChat promptVariant="bottom" />
    );

    const topRightControls = screen.getByRole('button', {
      name: 'Turn off Private Chat',
    }).parentElement;
    expect(topRightControls?.className).toContain('desktop-browser-inset-controls');

    const mainContent = container.querySelector('.main-content');
    expect(mainContent?.className).toContain('main-content--desktop-browser-inset');
    expect(
      container
        .querySelector<HTMLElement>('.app-container')
        ?.style.getPropertyValue('--desktop-browser-panel-width')
    ).toBe('clamp(380px, 42vw, 760px)');

    expect(
      screen
        .getByRole('form', { name: 'Prompt submission form bottom' })
        .getAttribute('data-desktop-right-inset')
    ).toBe('clamp(380px, 42vw, 760px)');
  });

  it('enables browser developer mode only for desktop Code tasks', () => {
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="work" isBrowserPreviewOpen />
    );
    expect(screen.getByLabelText('Desktop browser').getAttribute('data-developer-mode')).toBe(
      'false'
    );

    rerender(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" isBrowserPreviewOpen />
    );
    expect(screen.getByLabelText('Desktop browser').getAttribute('data-developer-mode')).toBe(
      'true'
    );
  });

  it('hides the private chat toggle while signed out', () => {
    render(<AppShellFrame {...baseProps} isAuthenticated={false} />);

    expect(screen.queryByRole('button', { name: 'Start Private Chat' })).toBeNull();
  });

  it('does not render empty chat chrome above the centered desktop prompt', () => {
    render(<AppShellFrame {...baseProps} />);

    expect(screen.queryByTestId('chat-view')).toBeNull();
    expect(screen.getByRole('form', { name: 'Prompt submission form centered' })).toBeTruthy();
  });

  it('renders chat view when messages exist', () => {
    render(
      <AppShellFrame
        {...baseProps}
        messages={[{ id: 'message-1', role: 'assistant', content: 'Done' }] as any}
        promptVariant="bottom"
      />
    );

    expect(screen.getByTestId('chat-view')).toBeTruthy();
  });

  it('reserves chat space for the active voice orb even from the centered prompt', () => {
    const { container } = render(
      <AppShellFrame
        {...baseProps}
        messages={[{ id: 'message-1', role: 'assistant', content: 'Done' }] as any}
        promptVariant="centered"
      />
    );

    const chatContainer = container.querySelector('.chat-container');
    expect(chatContainer?.className).not.toContain('chat-container--fixed-prompt');
    expect(chatContainer?.className).not.toContain('chat-container--voice-active');

    fireEvent.click(screen.getByRole('button', { name: 'Activate voice centered' }));

    expect(chatContainer?.className).toContain('chat-container--fixed-prompt');
    expect(chatContainer?.className).toContain('chat-container--voice-active');
  });

  it('renders desktop update states and invokes the update action', () => {
    const onCheckForUpdates = vi.fn();
    const { rerender } = render(
      <AppShellFrame
        {...baseProps}
        desktopUpdateVersion="1.2.3"
        desktopUpdateAction="idle"
        onCheckForUpdates={onCheckForUpdates}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install TaskForceAI 1.2.3' }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);

    rerender(
      <AppShellFrame
        {...baseProps}
        desktopUpdateVersion="1.2.3"
        desktopUpdateAction="installing"
        onCheckForUpdates={onCheckForUpdates}
      />
    );
    expect(screen.getByRole('button', { name: 'Installing TaskForceAI 1.2.3' })).toBeDisabled();
  });

  it('inserts workspace excerpts after an existing prompt', () => {
    const onPromptValueChange = vi.fn();
    render(
      <AppShellFrame
        {...baseProps}
        desktopRuntime
        desktopTaskMode="code"
        enableWorkspaceFileTree
        promptComposerProps={{ promptValue: 'Existing prompt  ', onPromptValueChange } as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert workspace excerpt' }));
    expect(onPromptValueChange).toHaveBeenCalledWith('Existing prompt\n\nworkspace excerpt');
  });
});
