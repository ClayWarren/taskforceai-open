import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ReactNode } from 'react';
import '../../../../tests/setup/dom';

vi.mock('@taskforceai/contracts/auth/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    getToken: vi.fn(),
    signOut: vi.fn(),
  },
}));

import { authClient } from '@taskforceai/contracts/auth/auth-client';
import { ok, err } from '@taskforceai/shared/result';
import { AuthProvider, type AuthProviderConfig, useAuth } from './AuthProvider';
import { type AuthenticatedUser, type SessionData } from './types';

const mockUser: AuthenticatedUser = {
  id: 1,
  email: 'test@example.com',
  full_name: 'Test User',
  plan: 'free',
  message_count: 0,
  free_tasks_remaining: 0,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  subscription_source: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'system',
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  mfa_enabled: false,
  notifications_enabled: true,
  trust_layer_enabled: true,
  quick_mode_enabled: true,
  customer_id: null,
  disabled: 'false',
  is_admin: 'false',
  trial_ends_at: null,
};

const mockSession: SessionData = {
  accessToken: 'token',
  expiresAt: Date.now() + 3600,
  user: {
    id: 1,
    email: 'test@example.com',
    plan: 'free',
  },
};

const mockFetchCurrentUser = vi.fn();

vi.mock('@taskforceai/contracts/api/account', () => ({
  fetchCurrentUser: () => mockFetchCurrentUser(),
}));

const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerDebug = vi.fn();

vi.mock('@taskforceai/contracts/auth/logger', () => ({
  getAuthLogger: () => ({
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
  }),
}));

const mockStoreAuthToken = vi.fn();
const mockClearAuthToken = vi.fn();

vi.mock('@taskforceai/contracts/auth/auth-storage', () => ({
  storeAuthToken: (...args: any[]) => mockStoreAuthToken(...args),
  clearAuthToken: (...args: any[]) => mockClearAuthToken(...args),
}));

const TestConsumer = () => {
  const {
    handleAuthFailure,
    isAuthenticated,
    isLoading,
    isTokenReady,
    logout,
    refreshUser,
    sessionStatus,
    user,
  } = useAuth();
  return (
    <div>
      <div data-testid="user">{user ? 'logged_in' : 'logged_out'}</div>
      <div data-testid="email">{user?.email ?? ''}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'authenticated' : 'anonymous'}</div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="token-ready">{isTokenReady ? 'ready' : 'waiting'}</div>
      <div data-testid="session-status">{sessionStatus ?? ''}</div>
      <button
        data-testid="force-fail-permanent"
        onClick={() => handleAuthFailure?.('profile_not_found')}
      >
        Permanent Fail
      </button>
      <button
        data-testid="force-fail-transient"
        onClick={() => handleAuthFailure?.('network_error')}
      >
        Transient Fail
      </button>
      <button data-testid="logout" onClick={() => void logout()}>
        Logout
      </button>
      <button data-testid="refresh" onClick={() => void refreshUser({ force: true })}>
        Refresh
      </button>
    </div>
  );
};

describe('AuthProvider', () => {
  let queryClient: QueryClient;

  const authStorage = (
    overrides: Partial<AuthProviderConfig['authStorage']> = {}
  ): AuthProviderConfig['authStorage'] => ({
    getSession: async () => ok(mockSession),
    setSession: async () => ok(undefined),
    clearSession: async () => ok(undefined),
    getToken: async () => ok(mockSession.accessToken),
    ...overrides,
  });

  const profileStorage = (
    overrides: Partial<AuthProviderConfig['profileStorage']> = {}
  ): AuthProviderConfig['profileStorage'] => ({
    loadProfile: async () => ok(mockUser),
    saveProfile: async () => ok(undefined),
    clearProfile: async () => ok(undefined),
    ...overrides,
  });

  const renderAuth = (
    config: Partial<AuthProviderConfig> = {},
    children: ReactNode = <TestConsumer />
  ) =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider
          config={{
            authStorage: authStorage(config.authStorage),
            profileStorage: profileStorage(config.profileStorage),
            ...config,
          }}
        >
          {children}
        </AuthProvider>
      </QueryClientProvider>
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    (authClient.getSession as any).mockResolvedValue({ user: { email: 'test@example.com' } });
    (authClient.getToken as any).mockResolvedValue('token');
    (authClient.signOut as any).mockResolvedValue(undefined);
    mockFetchCurrentUser.mockResolvedValue({ ok: true, value: { email: 'test@example.com' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
    cleanup();
  });

  it('skips grace period for permanent failures (profile_not_found) (Hardening TF-0361, TF-0362)', async () => {
    const view = renderAuth();

    // Initial state
    expect(view.getByTestId('user').textContent).toBe('logged_out');

    // Simulate authentication success internally
    await act(async () => {
      // Fast forward any initial load
      vi.advanceTimersByTime(100);
    });

    // Trigger a permanent failure
    await act(async () => {
      view.getByTestId('force-fail-permanent').click();
    });

    // SignOut should be called IMMEDIATELY without advancing the 10-second grace period timer
    expect(authClient.signOut).toHaveBeenCalled();
  });

  it('respects grace period for transient failures', async () => {
    const view = renderAuth();

    await act(async () => {
      // Fast forward any initial load to initialize the grace period timer
      vi.advanceTimersByTime(100);
    });

    // Advance 5 seconds (inside 10s grace period)
    await act(async () => {
      vi.advanceTimersByTime(5000);
      view.getByTestId('force-fail-transient').click();
    });
    expect(authClient.signOut).not.toHaveBeenCalled();

    // Advance past grace period (another 6 seconds, total 11s)
    await act(async () => {
      vi.advanceTimersByTime(6000);
      view.getByTestId('force-fail-transient').click();
    });
    expect(authClient.signOut).toHaveBeenCalled();
  });

  it('waits for the token to be ready before fetching the user profile', async () => {
    // 1. Mock session to be authenticated
    (authClient.getSession as any).mockResolvedValue({ user: { email: 'test@example.com' } });

    // 2. Mock getToken to be delayed
    let resolveToken: (value: string | null) => void;
    const tokenPromise = new Promise<string | null>((resolve) => {
      resolveToken = resolve;
    });
    (authClient.getToken as any).mockReturnValue(tokenPromise);

    // 3. Mock loadUserProfile
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'test@example.com' }));

    renderAuth(
      {
        authStorage: authStorage({
          getSession: async () => err(new Error('No session')),
          getToken: async () => err(new Error('No token')),
        }),
        profileStorage: profileStorage({
          loadProfile: async () => ok(null),
        }),
      },
      <div>Test</div>
    );

    // Advance timers to trigger session load
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // At this point, session is 'authenticated', but getToken is still pending.
    // loadUserProfile should NOT have been called yet because hasValidStoredToken is false.
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();

    // Now resolve the token
    await act(async () => {
      resolveToken!('fake-token');
      // Wait for the token-fetching promise and subsequent state updates
      await Promise.resolve();
      vi.advanceTimersByTime(100);
    });

    // Now loadUserProfile should have been called
    expect(mockFetchCurrentUser).toHaveBeenCalled();
  });

  it('keeps the updated local user when saveProfile fails during session sync', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'updated@example.com', name: 'Updated User' },
    });
    (authClient.getToken as any).mockResolvedValue('token');
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'updated@example.com' }));
    const saveProfile = vi.fn(async () => err(new Error('storage failed')));

    const view = renderAuth({
      profileStorage: profileStorage({ saveProfile }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('updated@example.com');
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'updated@example.com',
        full_name: 'Updated User',
      })
    );
  });

  it('logs out and clears local auth state', async () => {
    const calls: string[] = [];
    const clearSession = vi.fn(async () => {
      calls.push('clearSession');
      return ok(undefined);
    });
    const clearProfile = vi.fn(async () => ok(undefined));
    const onLogout = vi.fn(() => {
      calls.push('onLogout');
    });
    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
      onLogout,
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
    expect(calls).toEqual(['onLogout', 'clearSession']);
  });

  it('continues logout cleanup when the logout side effect fails', async () => {
    const clearSession = vi.fn(async () => ok(undefined));
    const clearProfile = vi.fn(async () => ok(undefined));
    const logoutError = new Error('native logout failed');
    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
      onLogout: vi.fn(async () => {
        throw logoutError;
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
  });

  it('continues logout cleanup when sign out and storage clearing fail', async () => {
    const clearSession = vi.fn(async () => {
      throw new Error('storage clear failed');
    });
    const clearProfile = vi.fn(async () => ok(undefined));
    (authClient.signOut as any).mockRejectedValueOnce(new Error('sign out failed'));

    const view = renderAuth({
      authStorage: authStorage({ clearSession }),
      profileStorage: profileStorage({ clearProfile }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    await act(async () => {
      view.getByTestId('logout').click();
      await Promise.resolve();
    });

    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).not.toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('continues forced auth failure cleanup when local storage clearing fails', async () => {
    const clearError = new Error('storage clear failed');
    const onAuthError = vi.fn();
    const view = renderAuth({
      onAuthError,
      authStorage: authStorage({
        clearSession: async () => {
          throw clearError;
        },
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
    });

    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network_error' }));
  });

  it('force refresh loads session and profile from storage', async () => {
    const refreshedUser = { ...mockUser, email: 'refreshed@example.com' };
    const loadProfile = vi.fn(async () => ok(refreshedUser));
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...mockSession, accessToken: 'old-token' }))
      .mockResolvedValue(ok({ ...mockSession, accessToken: 'fresh-token' }));
    const view = renderAuth({
      authStorage: authStorage({
        getSession,
        getToken: async () => ok('old-token'),
      }),
      profileStorage: profileStorage({ loadProfile }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    await act(async () => {
      view.getByTestId('refresh').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getSession).toHaveBeenCalled();
    expect(loadProfile).toHaveBeenCalled();
    expect(mockStoreAuthToken).toHaveBeenCalledWith('fresh-token');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
  });

  it('clears a cached profile when no stored session exists', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue(null);
    const clearProfile = vi.fn(async () => ok(undefined));
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'stale@example.com' }),
        clearProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('email').textContent).toBe('');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(clearProfile).toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('can render a cached profile before a cookie session resolves when explicitly enabled', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      allowProfileBootstrapWithoutSession: true,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'cached@example.com' }),
        clearProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('cached@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('anonymous');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(clearProfile).not.toHaveBeenCalled();
  });

  it('uses initial auth while the browser session is still loading', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const clearProfile = vi.fn(async () => ok(undefined));
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      initialAuth: {
        user: { ...mockUser, email: 'server@example.com' },
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
        clearProfile,
      }),
    });

    expect(view.getByTestId('email').textContent).toBe('server@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('authenticated');
    expect(view.getByTestId('loading').textContent).toBe('ready');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(view.getByTestId('session-status').textContent).toBe('authenticated');
    expect(clearProfile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'server@example.com' })
    );
  });

  it('logs bootstrap profile persistence failures for initial auth', async () => {
    (authClient.getSession as any).mockReturnValue(new Promise(() => {}));
    const storageError = new Error('profile save failed');
    const saveProfile = vi.fn(async () => err(storageError));

    renderAuth({
      initialAuth: {
        user: { ...mockUser, email: 'server@example.com' },
        isAuthenticated: true,
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'server@example.com' })
    );
  });

  it('clears a profile bootstrap once unauthenticated session polling settles without a token', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', message: 'Unauthorized', status: 401 },
    });
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      allowProfileBootstrapWithoutSession: true,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok({ ...mockUser, email: 'cached@example.com' }),
        clearProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(clearProfile).toHaveBeenCalled();
    expect(mockClearAuthToken).toHaveBeenCalled();
  });

  it('validates a token-only unauthenticated session once per token', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue(ok({ email: 'token@example.com' }));

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () =>
          ok({
            ...mockSession,
            accessToken: 'stored-token',
          }),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('token@example.com');
    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('does not call the web session endpoint when a native auth override is provided', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        isAuthenticated: true,
        isLoading: false,
        isTokenReady: true,
        sessionStatus: 'authenticated',
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('token-ready').textContent).toBe('ready');
    expect(authClient.getSession).not.toHaveBeenCalled();
    expect(authClient.getToken).not.toHaveBeenCalled();
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
  });

  it('uses auth override values for user, loading, token readiness, and session status', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        user: { ...mockUser, email: 'override@example.com' },
        isAuthenticated: false,
        isLoading: true,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('override@example.com');
    expect(view.getByTestId('authenticated').textContent).toBe('anonymous');
    expect(view.getByTestId('loading').textContent).toBe('loading');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(view.getByTestId('session-status').textContent).toBe('loading');
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it('derives authenticated auth override status when no explicit status is provided', async () => {
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
      authOverride: {
        isAuthenticated: true,
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('session-status').textContent).toBe('authenticated');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
  });

  it('clears local auth state when bootstrap storage throws', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    const clearProfile = vi.fn(async () => ok(undefined));
    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => {
          throw new Error('storage offline');
        },
      }),
      profileStorage: profileStorage({
        clearProfile,
        loadProfile: async () => {
          throw new Error('profile storage offline');
        },
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(clearProfile).not.toHaveBeenCalled();
  });

  it('reports authenticated-session token fetch failures', async () => {
    const onAuthError = vi.fn();
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session@example.com' },
    });
    (authClient.getToken as any).mockResolvedValue(null);

    renderAuth({
      onAuthError,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'token_fetch_failed' })
    );
  });

  it('fetches a bearer token when server bootstrap auth is authenticated but session polling is unauthenticated', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    (authClient.getToken as any).mockResolvedValue('bootstrap-token');

    renderAuth({
      initialAuth: {
        user: mockUser,
        isAuthenticated: true,
        sessionStatus: 'authenticated',
      },
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.getToken).toHaveBeenCalled();
    expect(mockStoreAuthToken).toHaveBeenCalledWith('bootstrap-token');
  });

  it('reports thrown token fetch errors through onAuthError', async () => {
    const onAuthError = vi.fn();
    const tokenError = new Error('token endpoint down');
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session@example.com' },
    });
    (authClient.getToken as any).mockRejectedValue(tokenError);

    renderAuth({
      onAuthError,
      authStorage: authStorage({
        getSession: async () => err(new Error('No session')),
        getToken: async () => err(new Error('No token')),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAuthError).toHaveBeenCalledWith(tokenError);
  });

  it('clears token-backed auth state when profile validation returns a permanent error', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', message: 'Unauthorized', status: 401 },
    });
    const clearProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => ok({ ...mockSession, accessToken: 'stored-token' }),
      }),
      profileStorage: profileStorage({
        clearProfile,
        loadProfile: async () => ok(mockUser),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockStoreAuthToken).toHaveBeenCalledWith('stored-token');
    expect(mockClearAuthToken).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
    expect(view.getByTestId('user').textContent).toBe('logged_out');
    expect(view.getByTestId('token-ready').textContent).toBe('waiting');
  });

  it('retains token-backed auth state when profile validation fails transiently', async () => {
    (authClient.getSession as any).mockResolvedValue(null);
    const transientError = { kind: 'network', message: 'offline' };
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: transientError,
    });

    const view = renderAuth({
      authStorage: authStorage({
        getSession: async () => ok({ ...mockSession, accessToken: 'stored-token' }),
      }),
      profileStorage: profileStorage({
        loadProfile: async () => ok(mockUser),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('user').textContent).toBe('logged_in');
    expect(view.getByTestId('token-ready').textContent).toBe('ready');
    expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to session identity when authenticated profile fetch fails transiently', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'network', message: 'offline' },
    });
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.getByTestId('email').textContent).toBe('session-user@example.com');
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'session-user@example.com',
        full_name: 'Session User',
      })
    );
  });

  it('ignores an authenticated profile response after the fetch is aborted', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    let resolveProfile!: (value: unknown) => void;
    mockFetchCurrentUser.mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );
    const saveProfile = vi.fn(async () => ok(undefined));

    const view = renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
        saveProfile,
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    view.unmount();

    await act(async () => {
      resolveProfile(ok({ ...mockUser, email: 'late@example.com' }));
      await Promise.resolve();
    });

    expect(saveProfile).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'late@example.com' })
    );
  });

  it('forces logout when authenticated profile fetch returns a permanent error', async () => {
    (authClient.getSession as any).mockResolvedValue({
      user: { email: 'session-user@example.com', name: 'Session User' },
    });
    mockFetchCurrentUser.mockResolvedValue({
      ok: false,
      error: { kind: 'not_found', message: 'Missing profile', status: 404 },
    });

    renderAuth({
      profileStorage: profileStorage({
        loadProfile: async () => ok(null),
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('does not repeat forced auth failure cleanup while a failure is already being handled', async () => {
    let releaseLogout!: () => void;
    const onLogout = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseLogout = resolve;
        })
    );
    const view = renderAuth({ onLogout });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
    });

    expect(onLogout).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseLogout();
      await Promise.resolve();
    });
  });

  it('continues forced auth failure cleanup when logout hooks and signout fail', async () => {
    const logoutError = new Error('logout hook failed');
    const signOutError = new Error('signout failed');
    const onAuthError = vi.fn();
    (authClient.signOut as any).mockRejectedValueOnce(signOutError);
    const view = renderAuth({
      onAuthError,
      onLogout: vi.fn(async () => {
        throw logoutError;
      }),
    });

    await act(async () => {
      vi.advanceTimersByTime(11_000);
      view.getByTestId('force-fail-transient').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network_error' }));
  });

  it('throws when useAuth is rendered outside AuthProvider', () => {
    const BrokenConsumer = () => {
      useAuth();
      return null;
    };

    expect(() => render(<BrokenConsumer />)).toThrow('useAuth must be used within an AuthProvider');
  });
});
