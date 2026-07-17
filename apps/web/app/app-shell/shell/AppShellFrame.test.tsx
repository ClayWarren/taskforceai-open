import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const invokeTauri = vi.fn(async () => ({
  entries: [{ path: 'src/app.ts', name: 'app.ts', depth: 1, isDirectory: false }],
  root: '/workspace',
  roots: ['/workspace'],
  truncated: false,
}));

vi.mock('../../lib/platform/desktop-api', () => ({ invokeTauri }));

vi.mock('../../components/shell/Sidebar', () => ({
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

vi.mock('../chat/AppPromptComposer', () => ({
  AppPromptComposer: ({
    desktopPinnedSummaryInset,
    desktopRightInset,
    onRealtimeVoiceActiveChange,
    variant,
  }: {
    desktopPinnedSummaryInset?: boolean;
    desktopRightInset?: string;
    onRealtimeVoiceActiveChange?: (_isActive: boolean) => void;
    variant: string;
  }) => (
    <form
      aria-label={`Prompt submission form ${variant}`}
      data-desktop-pinned-summary-inset={String(Boolean(desktopPinnedSummaryInset))}
      data-desktop-right-inset={desktopRightInset ?? ''}
    >
      <button type="button" onClick={() => onRealtimeVoiceActiveChange?.(true)}>
        Activate voice {variant}
      </button>
    </form>
  ),
}));

vi.mock('../chat/ChatView', () => ({
  ChatView: ({ executionPresentation }: { executionPresentation?: 'standard' | 'code' }) => (
    <div data-execution-presentation={executionPresentation ?? ''} data-testid="chat-view" />
  ),
}));

vi.mock('../navigation/CollapsedSidebar', () => ({
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

vi.mock('../../lib/platform/desktop-ui', () => ({
  DESKTOP_CODE_WORKSPACE_PANE_WIDTH: 'min(68vw, 1180px)',
  DesktopAuthButtons: ({ onSignIn }: { onSignIn: () => void }) => (
    <button type="button" onClick={onSignIn}>
      Sign in
    </button>
  ),
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
  DesktopCodeOpenInMenu: () => <button type="button">Open workspace in</button>,
  DesktopCodePinnedSummary: ({
    onOpenEnvironment,
    onReviewChanges,
  }: {
    onOpenEnvironment: () => void;
    onReviewChanges: () => void;
  }) => (
    <aside aria-label="Pinned Code summary">
      <button type="button" onClick={onOpenEnvironment}>
        Pinned environment
      </button>
      <button type="button" onClick={onReviewChanges}>
        Pinned changes
      </button>
    </aside>
  ),
  DesktopCodeWorkspaceSurface: ({
    open,
    onOpenChange,
    onViewChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onViewChange: (view: 'review') => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => {
          onViewChange('review');
          onOpenChange(true);
        }}
      >
        Review workspace changes
      </button>
      {open ? <aside aria-label="Code workspace" /> : null}
    </>
  ),
  DesktopCompanion: () => null,
  DesktopTerminalPanel: ({ scopeKey }: { scopeKey?: string }) => (
    <div data-scope-key={scopeKey ?? ''} data-testid="desktop-terminal" />
  ),
  DesktopUpdateButton: ({
    desktopUpdateAction,
    desktopUpdateVersion,
    onCheckForUpdates,
  }: {
    desktopUpdateAction: 'idle' | 'checking' | 'installing';
    desktopUpdateVersion: string;
    onCheckForUpdates: () => void;
  }) => (
    <button type="button" disabled={desktopUpdateAction !== 'idle'} onClick={onCheckForUpdates}>
      {desktopUpdateAction === 'installing' ? 'Installing' : 'Install'} TaskForceAI{' '}
      {desktopUpdateVersion}
    </button>
  ),
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

vi.mock('../navigation/icons', () => ({
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
    expect(screen.getByTestId('desktop-terminal').getAttribute('data-scope-key')).toBe(
      'task:conversation-id'
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

  it('opens the command palette globally and hides Code commands in Work mode', () => {
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="work" />
    );
    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open workspace files/ })).toBeNull();

    rerender(<AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" />);
    expect(screen.getByRole('button', { name: /Open workspace files/ })).toBeTruthy();
  });

  it('shows Open in only for desktop Code mode', () => {
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="work" />
    );
    expect(screen.queryByRole('button', { name: 'Open workspace in' })).toBeNull();

    rerender(<AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" />);
    expect(screen.getByRole('button', { name: 'Open workspace in' })).toBeTruthy();
  });

  it('keeps signed-out auth and Code actions in the same inset control group', () => {
    render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" isAuthenticated={false} />
    );

    const signIn = screen.getByRole('button', { name: 'Sign in' });
    const openIn = screen.getByRole('button', { name: 'Open workspace in' });
    expect(signIn.parentElement).toBe(openIn.parentElement);

    fireEvent.click(screen.getByRole('button', { name: 'Open Code workspace tools' }));
    expect(signIn.parentElement?.className).toContain('desktop-browser-inset-controls');
  });

  it('opens the Code workspace pane from desktop Code controls and insets the composer', () => {
    const { container } = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" promptVariant="bottom" />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Code workspace tools' }));

    expect(screen.getByLabelText('Code workspace')).toBeTruthy();
    expect(
      container
        .querySelector<HTMLElement>('.app-container')
        ?.style.getPropertyValue('--desktop-browser-panel-width')
    ).toBe('min(68vw, 1180px)');
    expect(
      screen
        .getByRole('form', { name: 'Prompt submission form bottom' })
        .getAttribute('data-desktop-right-inset')
    ).toBe('min(68vw, 1180px)');
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

  it('shows the pinned summary only after a Work conversation starts', () => {
    const messages = [{ id: 'message-1', role: 'user', content: 'Research this' }] as any;
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopTaskMode="work" messages={[]} />
    );

    expect(screen.queryByLabelText('Pinned summary')).toBeNull();

    rerender(<AppShellFrame {...baseProps} desktopTaskMode="work" messages={messages} />);
    expect(screen.getByLabelText('Pinned summary')).toBeTruthy();

    rerender(<AppShellFrame {...baseProps} desktopTaskMode="chat" messages={messages} />);
    expect(screen.queryByLabelText('Pinned summary')).toBeNull();
  });

  it('shows the Code summary only for started desktop Code conversations', () => {
    const messages = [{ id: 'message-1', role: 'user', content: 'Change this' }] as any;
    const { rerender } = render(
      <AppShellFrame {...baseProps} desktopTaskMode="code" messages={messages} />
    );

    expect(screen.queryByLabelText('Pinned Code summary')).toBeNull();

    rerender(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" messages={messages} />
    );
    expect(screen.getByLabelText('Pinned Code summary')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pinned environment' }));
    expect(screen.getByLabelText('Code workspace')).toBeTruthy();

    cleanup();
    render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="code" messages={messages} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pinned changes' }));
    expect(screen.getByLabelText('Code workspace')).toBeTruthy();
  });

  it('reserves chat and composer space for the pinned summary and toggles it beside Open in', () => {
    const messages = [{ id: 'message-1', role: 'user', content: 'Change this' }] as any;
    const { container } = render(
      <AppShellFrame
        {...baseProps}
        desktopRuntime
        desktopTaskMode="code"
        messages={messages}
        promptVariant="bottom"
      />
    );

    const openIn = screen.getByRole('button', { name: 'Open workspace in' });
    const collapse = screen.getByRole('button', { name: 'Collapse pinned summary' });
    const mainContent = container.querySelector('.main-content');
    const composer = screen.getByRole('form', { name: 'Prompt submission form bottom' });

    expect(openIn.parentElement).toBe(collapse.parentElement);
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-pressed')).toBe('true');
    expect(collapse.className).toContain('inline-flex');
    expect(collapse.className).not.toContain('hidden');
    expect(collapse.className).toContain('text-blue-200');
    const workspaceTools = screen.getByRole('button', { name: 'Open Code workspace tools' });
    expect(workspaceTools.parentElement).toBe(collapse.parentElement);
    expect(workspaceTools.className).toContain('text-slate-300');
    expect(mainContent?.className).toContain('main-content--pinned-summary-inset');
    expect(composer.getAttribute('data-desktop-right-inset')).toBe('24rem');
    expect(composer.getAttribute('data-desktop-pinned-summary-inset')).toBe('true');

    fireEvent.click(collapse);

    const expand = screen.getByRole('button', { name: 'Expand pinned summary' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.getAttribute('aria-pressed')).toBe('false');
    expect(expand.className).not.toContain('text-blue-200');
    expect(screen.queryByLabelText('Pinned Code summary')).toBeNull();
    expect(mainContent?.className).not.toContain('main-content--pinned-summary-inset');
    expect(composer.getAttribute('data-desktop-right-inset')).toBe('');
    expect(composer.getAttribute('data-desktop-pinned-summary-inset')).toBe('false');

    fireEvent.click(expand);

    expect(screen.getByLabelText('Pinned Code summary')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse pinned summary' })).toBeTruthy();

    fireEvent.click(workspaceTools);

    expect(screen.getByLabelText('Code workspace')).toBeTruthy();
    expect(screen.queryByLabelText('Pinned Code summary')).toBeNull();
  });

  it('creates Work output prompts from empty and existing drafts', () => {
    const onPromptValueChange = vi.fn();
    const messages = [{ id: 'message-1', role: 'user', content: 'Research this' }] as any;
    const { rerender } = render(
      <AppShellFrame
        {...baseProps}
        desktopTaskMode="work"
        messages={messages}
        promptComposerProps={{ promptValue: '', onPromptValueChange } as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create a file or site' }));
    expect(onPromptValueChange).toHaveBeenLastCalledWith('Create a file or site');

    rerender(
      <AppShellFrame
        {...baseProps}
        desktopTaskMode="work"
        messages={messages}
        promptComposerProps={{ promptValue: 'Draft output', onPromptValueChange } as any}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create a file or site' }));
    expect(onPromptValueChange).toHaveBeenLastCalledWith('Draft output\n\nCreate a file or site');
  });

  it('runs Code workspace and workspace-file commands', async () => {
    const onPromptValueChange = vi.fn();
    render(
      <AppShellFrame
        {...baseProps}
        desktopRuntime
        desktopTaskMode="code"
        promptComposerProps={{ promptValue: 'Inspect this  ', onPromptValueChange } as any}
      />
    );

    fireEvent.keyDown(window, { key: 'W', metaKey: true, shiftKey: true });
    expect(screen.getByLabelText('Code workspace')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true });
    fireEvent.click(await screen.findByText('app.ts'));
    expect(onPromptValueChange).toHaveBeenCalledWith('Inspect this\n@src/app.ts');
  });

  it('navigates adjacent tasks, tolerates loader failures, and no-ops without task callbacks', async () => {
    const noCallbacks = render(
      <AppShellFrame {...baseProps} desktopRuntime desktopTaskMode="work" />
    );
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    noCallbacks.unmount();

    const loadPaletteTasks = vi.fn(async () => [
      {
        conversationId: 'conversation-id',
        title: 'Current',
        createdAt: 1,
        updatedAt: 1,
        lastMessagePreview: null,
      },
      {
        conversationId: 'conversation-next',
        title: 'Next',
        createdAt: 2,
        updatedAt: 2,
        lastMessagePreview: null,
      },
    ]);
    const onPaletteTaskSelect = vi.fn(async () => undefined);
    render(
      <AppShellFrame
        {...baseProps}
        desktopRuntime
        desktopTaskMode="work"
        loadPaletteTasks={loadPaletteTasks}
        onPaletteTaskSelect={onPaletteTaskSelect}
      />
    );

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    await waitFor(() =>
      expect(onPaletteTaskSelect).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'conversation-next' })
      )
    );

    loadPaletteTasks.mockRejectedValueOnce(new Error('task list unavailable'));
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(loadPaletteTasks).toHaveBeenCalledTimes(2));
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

  it('uses the Code execution presentation only in desktop Code mode', () => {
    const messages = [{ id: 'code-message', role: 'assistant', content: 'Code update' }] as any;
    const { rerender } = render(
      <AppShellFrame {...baseProps} messages={messages} desktopRuntime desktopTaskMode="code" />
    );
    expect(screen.getByTestId('chat-view').getAttribute('data-execution-presentation')).toBe(
      'code'
    );

    rerender(
      <AppShellFrame {...baseProps} messages={messages} desktopRuntime desktopTaskMode="work" />
    );
    expect(screen.getByTestId('chat-view').getAttribute('data-execution-presentation')).toBe(
      'standard'
    );
  });
});
