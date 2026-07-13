import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { PROMPT_DRAFT_CAPTURE_EVENT } from '../lib/prompt/hydration-draft-capture';
import {
  AppShell,
  appPromptComposerSpy,
  appShellTestState,
  chatViewSpy,
  cleanupAppShellTestHarness,
  emitDesktopMenuEvent,
  getSignInUrlMock,
  invokeTauriMock,
  listenTauriEventMock,
  mockConversationState,
  mockDeviceLoginCommands,
  mockUnauthenticated,
  renderAppShell,
  resetAppShellTestHarness,
  routerPushMock,
  streamingStoreResetMock,
  useAuth,
  useConversationState,
  useProfileModal,
  useStreamingMessagesMock,
  waitForTauriBridgeMock,
  type PromptDraftTestWindow,
} from './AppShell.test-harness';

describe('AppShell', () => {
  afterEach(() => {
    cleanupAppShellTestHarness();
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await resetAppShellTestHarness();
  });

  it('renders main layout components', async () => {
    await renderAppShell();
    expect(screen.getByTestId('chat-view')).toBeTruthy();
  });

  it('isolates auth latency marker failures from app rendering', async () => {
    (window as PromptDraftTestWindow).__TASKFORCEAI_LATENCY_MARK__ = () => {
      throw new Error('latency marker failed');
    };

    await renderAppShell();

    expect(screen.getByTestId('chat-view')).toBeTruthy();
  });

  it('renders current sidebar actions', async () => {
    await renderAppShell();
    expect(screen.getByTestId('search-btn')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('toggles Private Chat from the top-right control', async () => {
    await renderAppShell();

    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: false });
    expect(screen.getByRole('button', { name: 'Start Private Chat' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Private Chat' }));
      await Promise.resolve();
    });

    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: true });
    expect(screen.getByRole('button', { name: 'Turn off Private Chat' })).toBeTruthy();
    expect(screen.queryByTestId('pending-prompts')).toBeNull();
    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ isPrivateChat: true, persistenceEnabled: false })
    );
    expect(streamingStoreResetMock).toHaveBeenCalled();
  });

  it('turns off and hides Private Chat when switching to Work', async () => {
    await renderAppShell();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Private Chat' }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /Work mode/ }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /Private Chat/ })).toBeNull());
    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: false });
  });

  it('hides Private Chat while signed out', async () => {
    mockUnauthenticated(false);

    await renderAppShell();

    expect(screen.queryByRole('button', { name: 'Start Private Chat' })).toBeNull();
    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: false });
  });

  it('turns off Private Chat when the current session signs out', async () => {
    const { rerender } = await renderAppShell();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start Private Chat' }));
      await Promise.resolve();
    });

    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: true });

    mockUnauthenticated(false);
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /Private Chat/ })).toBeNull();
    expect(useConversationState).toHaveBeenLastCalledWith({ isPrivateMode: false });
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

  it('shows desktop quick actions only in desktop runtime', async () => {
    const { rerender } = await renderAppShell();
    expect(screen.queryByTestId('show-terminal-btn')).toBeNull();
    expect(screen.queryByTestId('open-browser-preview-btn')).toBeNull();
    expect(screen.queryByLabelText('Desktop terminal')).toBeNull();

    appShellTestState.platformRuntime = 'desktop';
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('open-browser-preview-btn'));
    fireEvent.click(screen.getByTestId('show-terminal-btn'));

    expect(screen.getByLabelText('Desktop browser')).toBeTruthy();
    expect(invokeTauriMock).not.toHaveBeenCalledWith('desktop_browser_show');
    expect(screen.getByLabelText('Desktop terminal')).toBeTruthy();
    expect(invokeTauriMock).not.toHaveBeenCalledWith('show_terminal');
  });

  it('checks for desktop updates in desktop runtime', async () => {
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

    appShellTestState.platformRuntime = 'desktop';
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
    expect(screen.getByTestId('desktop-update-message').textContent).toBe(
      'TaskForceAI is up to date (0.4.1).'
    );
  });

  it('opens settings from the desktop app menu', async () => {
    const mockOpen = vi.fn();
    (useProfileModal as any).mockReturnValue({ open: mockOpen });
    appShellTestState.platformRuntime = 'desktop';

    await renderAppShell();
    await emitDesktopMenuEvent('desktop-menu:settings');

    expect(listenTauriEventMock).toHaveBeenCalledWith(
      'desktop-menu:settings',
      expect.any(Function)
    );
    expect(mockOpen).toHaveBeenCalled();
  });

  it('checks for updates from the desktop app menu', async () => {
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
    appShellTestState.platformRuntime = 'desktop';

    await renderAppShell();
    await emitDesktopMenuEvent('desktop-menu:check-for-updates');

    expect(listenTauriEventMock).toHaveBeenCalledWith(
      'desktop-menu:check-for-updates',
      expect.any(Function)
    );
    expect(invokeTauriMock).toHaveBeenCalledWith('desktop_update_check');
    expect(screen.getByTestId('desktop-update-message').textContent).toBe(
      'TaskForceAI is up to date (0.4.1).'
    );
  });

  it('opens the browser preview from the desktop app menu', async () => {
    appShellTestState.platformRuntime = 'desktop';

    await renderAppShell();
    await emitDesktopMenuEvent('desktop-menu:browser-preview');

    expect(listenTauriEventMock).toHaveBeenCalledWith(
      'desktop-menu:browser-preview',
      expect.any(Function)
    );
    expect(screen.getByLabelText('Desktop browser')).toBeTruthy();
    expect(invokeTauriMock).not.toHaveBeenCalledWith('desktop_browser_show');
  });

  it('opens explicit links in the desktop browser preview', async () => {
    appShellTestState.platformRuntime = 'desktop';
    await renderAppShell();
    const link = document.createElement('a');
    link.href = 'http://localhost:4177/settings';
    link.textContent = 'Local settings route';
    document.body.appendChild(link);

    fireEvent.click(link);

    await waitFor(() =>
      expect(invokeTauriMock).toHaveBeenCalledWith('desktop_browser_open', {
        params: { url: 'http://localhost:4177/settings' },
      })
    );
    link.remove();
  });

  it('leaves browser-runtime and modified link clicks alone', async () => {
    await renderAppShell();
    const browserRuntimeLink = document.createElement('a');
    browserRuntimeLink.href = 'https://example.com/docs';
    browserRuntimeLink.textContent = 'Docs';
    document.body.appendChild(browserRuntimeLink);

    fireEvent.click(browserRuntimeLink);
    expect(invokeTauriMock).not.toHaveBeenCalledWith('desktop_browser_open', expect.anything());
    browserRuntimeLink.remove();

    appShellTestState.platformRuntime = 'desktop';
    const { rerender } = await renderAppShell();
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const modifiedClickLink = document.createElement('a');
    modifiedClickLink.href = 'https://example.com/source';
    modifiedClickLink.textContent = 'Source';
    document.body.appendChild(modifiedClickLink);

    fireEvent.click(modifiedClickLink, { metaKey: true });
    expect(invokeTauriMock).not.toHaveBeenCalledWith('desktop_browser_open', expect.anything());
    modifiedClickLink.remove();
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

    appShellTestState.platformRuntime = 'desktop';
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
    appShellTestState.platformRuntime = 'desktop';
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

  it('keeps the centered prompt usable while auth is hydrating on new chat', async () => {
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
    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isDisabled: false,
        showPromptLogo: true,
        variant: 'centered',
      })
    );
  });

  it('preserves a centered prompt draft when auth resolves before conversation restore', async () => {
    mockUnauthenticated(true);
    mockConversationState({
      isInitialized: false,
      messages: [],
    });

    const { rerender } = await renderAppShell();
    const centeredCall = appPromptComposerSpy.mock.calls.find(
      ([props]) => props.variant === 'centered'
    );
    expect(centeredCall).toBeTruthy();

    await act(async () => {
      centeredCall?.[0].onPromptValueChange('draft while auth hydrates');
      await Promise.resolve();
    });

    appPromptComposerSpy.mockClear();
    mockUnauthenticated(false);
    mockConversationState({
      isInitialized: false,
      messages: [],
    });
    await act(async () => {
      rerender(<AppShell />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('prompt-form-centered')).toBeTruthy();
    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        isDisabled: false,
        promptValue: 'draft while auth hydrates',
        variant: 'centered',
      })
    );
  });

  it('adopts a prompt draft captured before React hydration', async () => {
    (window as PromptDraftTestWindow).__TASKFORCEAI_PROMPT_DRAFT__ = 'typed before hydration';
    mockUnauthenticated(true);
    mockConversationState({
      isInitialized: false,
      messages: [],
    });

    await renderAppShell();

    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        promptValue: 'typed before hydration',
        variant: 'centered',
      })
    );
  });

  it('adopts a prompt draft captured after AppShell mounts', async () => {
    mockUnauthenticated(true);
    mockConversationState({
      isInitialized: false,
      messages: [],
    });

    await renderAppShell();
    appPromptComposerSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(PROMPT_DRAFT_CAPTURE_EVENT, {
          detail: { value: 'typed while hydrating' },
        })
      );
      await Promise.resolve();
    });

    expect(appPromptComposerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        promptValue: 'typed while hydrating',
        variant: 'centered',
      })
    );
  });
});
