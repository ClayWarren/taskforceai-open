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

vi.mock('@taskforceai/contracts/auth/logger', () => ({
  getAuthLogger: () => ({
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: mockLoggerInfo,
    debug: vi.fn(),
  }),
}));

const mockStoreAuthToken = vi.fn();
const mockClearAuthToken = vi.fn();

vi.mock('@taskforceai/contracts/auth/auth-storage', () => ({
  storeAuthToken: (...args: any[]) => mockStoreAuthToken(...args),
  clearAuthToken: (...args: any[]) => mockClearAuthToken(...args),
}));

const TestConsumer = () => {
  const { handleAuthFailure, isLoading, isTokenReady, logout, refreshUser, user } = useAuth();
  return (
    <div>
      <div data-testid="user">{user ? 'logged_in' : 'logged_out'}</div>
      <div data-testid="email">{user?.email ?? ''}</div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="token-ready">{isTokenReady ? 'ready' : 'waiting'}</div>
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
    });

    expect(authClient.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(clearSession).toHaveBeenCalled();
    expect(clearProfile).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
    expect(calls).toEqual(['onLogout', 'clearSession']);
  });

  it('force refresh loads session and profile from storage', async () => {
    const refreshedUser = { ...mockUser, email: 'refreshed@example.com' };
    const loadProfile = vi.fn(async () => ok(refreshedUser));
    const getSession = vi.fn(async () => ok({ ...mockSession, accessToken: 'fresh-token' }));
    const view = renderAuth({
      authStorage: authStorage({
        getSession,
        getToken: async () => ok('fresh-token'),
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
    });

    expect(getSession).toHaveBeenCalled();
    expect(loadProfile).toHaveBeenCalled();
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
});
