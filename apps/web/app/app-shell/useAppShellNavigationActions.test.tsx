import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopAppServerAuthStatus = mock();
const openDesktopExternalUrl = mock();
const pollDesktopAppServerDeviceLogin = mock();
const startDesktopAppServerDeviceLogin = mock();
const waitForTauriBridge = mock();
const getSignInUrl = mock();
const loggerDebug = mock();
const loggerError = mock();
const loggerInfo = mock();

mock.module('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSignInUrl,
  },
}));

mock.module('../lib/platform/desktop/app-server', () => ({
  getDesktopAppServerAuthStatus,
  openDesktopExternalUrl,
  pollDesktopAppServerDeviceLogin,
  startDesktopAppServerDeviceLogin,
}));

mock.module('../lib/platform/desktop/bridge', () => ({
  waitForTauriBridge,
}));

mock.module('../lib/logger', () => ({
  logger: {
    debug: loggerDebug,
    error: loggerError,
    info: loggerInfo,
  },
}));

import { useAppShellNavigationActions } from './useAppShellNavigationActions';

const originalLocation = window.location;
const originalAlert = window.alert;

const createOptions = (
  overrides: Partial<Parameters<typeof useAppShellNavigationActions>[0]> = {}
) => ({
  isAuthenticated: true,
  messageSession: {
    conversation: {
      onSendMessage: mock(),
    },
  },
  openProfileModal: mock(),
  platformRuntime: 'browser' as const,
  router: {
    push: mock(async () => undefined),
  },
  setIsSidebarOpen: mock(),
  ...overrides,
});

describe('useAppShellNavigationActions', () => {
  const assign = mock();
  const reload = mock();
  const alert = mock();

  beforeEach(() => {
    for (const fn of [
      assign,
      reload,
      alert,
      getDesktopAppServerAuthStatus,
      openDesktopExternalUrl,
      pollDesktopAppServerDeviceLogin,
      startDesktopAppServerDeviceLogin,
      waitForTauriBridge,
      getSignInUrl,
      loggerDebug,
      loggerError,
      loggerInfo,
    ]) {
      fn.mockReset();
    }

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'https://app.taskforceai.chat',
        href: 'https://app.taskforceai.chat/',
        assign,
        reload,
      },
    });
    window.alert = alert as typeof window.alert;
    waitForTauriBridge.mockResolvedValue(false);
    getSignInUrl.mockReturnValue('/api/v1/auth/login?callbackUrl=%2F');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    window.alert = originalAlert;
  });

  it('routes logo clicks and forwards prompt submissions', async () => {
    const options = createOptions();
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleLogoClick();
      result.current.handleSendMessage('hello');
    });

    await waitFor(() => expect(options.router.push).toHaveBeenCalledWith('/'));
    expect(options.messageSession.conversation.onSendMessage).toHaveBeenCalledWith('hello');
  });

  it('opens changelog on the marketing site and closes the sidebar', () => {
    const options = createOptions();
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleOpenChangelog();
    });

    expect(options.setIsSidebarOpen).toHaveBeenCalledWith(false);
    expect(window.location.href).toBe('https://taskforceai.chat/changelog');
  });

  it('guards profile open while unauthenticated and closes sidebar when opened', () => {
    const openProfileModal = mock(({ onOpen }: { onOpen: () => void }) => onOpen());
    const unauthenticated = createOptions({ isAuthenticated: false, openProfileModal });
    const { result, rerender } = renderHook((options) => useAppShellNavigationActions(options), {
      initialProps: unauthenticated,
    });

    act(() => {
      result.current.handleOpenProfile();
    });

    expect(openProfileModal).not.toHaveBeenCalled();
    expect(loggerDebug).toHaveBeenCalledWith(
      '[AppShell] Ignoring profile open while unauthenticated'
    );

    const authenticated = createOptions({ isAuthenticated: true, openProfileModal });
    rerender(authenticated);

    act(() => {
      result.current.handleOpenProfile();
    });

    expect(loggerInfo).toHaveBeenCalledWith('[AppShell] Opening profile modal');
    expect(openProfileModal).toHaveBeenCalledTimes(1);
    expect(authenticated.setIsSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('uses browser sign-in when desktop runtime is unavailable', async () => {
    const options = createOptions({ platformRuntime: 'browser' });
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleSignInClick();
    });

    await waitFor(() => expect(waitForTauriBridge).toHaveBeenCalledWith(500));
    expect(getSignInUrl).toHaveBeenCalledWith({ callbackUrl: '/' });
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?callbackUrl=%2F');
  });

  it('opens desktop device login and reloads after auth confirmation', async () => {
    startDesktopAppServerDeviceLogin.mockResolvedValue({
      deviceCode: 'device-code',
      expiresIn: 120,
      interval: 1,
      userCode: 'USER-CODE',
      verificationUri: 'https://auth.taskforceai.chat/device',
      verificationUriComplete: 'https://auth.taskforceai.chat/device?user_code=USER-CODE',
    });
    openDesktopExternalUrl.mockResolvedValue(undefined);
    pollDesktopAppServerDeviceLogin.mockResolvedValue({ status: 'approved' });
    getDesktopAppServerAuthStatus.mockResolvedValue({ authenticated: true });
    const options = createOptions({ platformRuntime: 'desktop' });
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleSignInClick();
    });

    await waitFor(() =>
      expect(openDesktopExternalUrl).toHaveBeenCalledWith(
        'https://auth.taskforceai.chat/device?user_code=USER-CODE&client=desktop'
      )
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(pollDesktopAppServerDeviceLogin).toHaveBeenCalledWith('device-code');
    expect(getDesktopAppServerAuthStatus).toHaveBeenCalledTimes(1);
    expect(loggerInfo).toHaveBeenCalledWith('[AppShell] Desktop sign-in opened in browser', {
      userCode: 'USER-CODE',
    });
  });

  it('adds desktop hints to malformed device login URLs and handles slow-down polling', async () => {
    startDesktopAppServerDeviceLogin.mockResolvedValue({
      deviceCode: 'device-code',
      expiresIn: 120,
      interval: 1,
      userCode: 'USER-CODE',
      verificationUri: 'http://[invalid?user_code=USER-CODE',
      verificationUriComplete: '',
    });
    openDesktopExternalUrl.mockResolvedValue(undefined);
    pollDesktopAppServerDeviceLogin
      .mockResolvedValueOnce({ status: 'slow_down' })
      .mockResolvedValueOnce({ status: 'approved' });
    getDesktopAppServerAuthStatus.mockResolvedValue({ authenticated: true });
    const options = createOptions({ platformRuntime: 'desktop' });
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleSignInClick();
    });

    await waitFor(() =>
      expect(openDesktopExternalUrl).toHaveBeenCalledWith(
        'http://[invalid?user_code=USER-CODE&client=desktop'
      )
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(pollDesktopAppServerDeviceLogin).toHaveBeenCalledTimes(2);
  });

  it('surfaces approved desktop sign-in when the app session is not saved', async () => {
    startDesktopAppServerDeviceLogin.mockResolvedValue({
      deviceCode: 'device-code',
      expiresIn: 120,
      interval: 1,
      userCode: 'USER-CODE',
      verificationUri: 'https://auth.taskforceai.chat/device',
      verificationUriComplete: 'https://auth.taskforceai.chat/device?user_code=USER-CODE',
    });
    openDesktopExternalUrl.mockResolvedValue(undefined);
    pollDesktopAppServerDeviceLogin.mockResolvedValue({ status: 'approved' });
    getDesktopAppServerAuthStatus.mockResolvedValue({ authenticated: false });
    const options = createOptions({ platformRuntime: 'desktop' });
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleSignInClick();
    });

    await waitFor(
      () =>
        expect(alert).toHaveBeenCalledWith(
          'Desktop sign-in was approved, but the app did not save the session.'
        ),
      { timeout: 4_000 }
    );
    expect(reload).not.toHaveBeenCalled();
    expect(getDesktopAppServerAuthStatus).toHaveBeenCalledTimes(5);
  });

  it('surfaces desktop sign-in failures to the user', async () => {
    startDesktopAppServerDeviceLogin.mockRejectedValue(new Error('device flow unavailable'));
    const options = createOptions({ platformRuntime: 'desktop' });
    const { result } = renderHook(() => useAppShellNavigationActions(options));

    act(() => {
      result.current.handleSignInClick();
    });

    await waitFor(() =>
      expect(loggerError).toHaveBeenCalledWith('[AppShell] Desktop sign-in failed', {
        error: expect.any(Error),
      })
    );
    expect(alert).toHaveBeenCalledWith('device flow unavailable');
  });
});
