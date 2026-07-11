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
  CollapsedSidebar: ({ isSidebarOpen }: { isSidebarOpen: boolean }) => (
    <div data-testid="collapsed-sidebar" data-open={String(isSidebarOpen)} />
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
  DesktopBrowserPanel: ({ open, width }: { open: boolean; width?: string }) =>
    open ? <aside aria-label="Desktop browser" data-width={width ?? ''} /> : null,
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

    const toggle = screen.getByRole('button', { name: 'Turn off Private Chat' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);

    expect(onTogglePrivateChat).toHaveBeenCalledTimes(1);
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
});
