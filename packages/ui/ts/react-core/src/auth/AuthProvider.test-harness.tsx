// oxlint-disable typescript/no-floating-promises, typescript/no-misused-promises -- Bun mocks register synchronously; test buttons intentionally invoke async auth actions.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../../../tests/setup/dom';

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: { getSession: vi.fn(), getToken: vi.fn(), signOut: vi.fn() },
}));

import { fetchCurrentUser } from '@taskforceai/api-client/api/account';
import { authClient } from '@taskforceai/api-client/auth/auth-client';
import type { AuthenticatedUser, SessionData } from '@taskforceai/api-client/auth/types';
import { ok } from '@taskforceai/client-core/result';
import { AuthProvider, type AuthProviderConfig, useAuth } from './AuthProvider';

export const mockUser: AuthenticatedUser = {
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
  is_admin: false,
  trial_ends_at: null,
};

export const mockSession: SessionData = {
  accessToken: 'token',
  expiresAt: Date.now() + 3600,
  user: { id: 1, email: 'test@example.com', plan: 'free' },
};

export const mockFetchCurrentUser = vi.fn();
vi.mock('@taskforceai/api-client/api/account', () => ({
  fetchCurrentUser: () => mockFetchCurrentUser(),
}));

export const mockLoggerWarn = vi.fn();
export const mockLoggerError = vi.fn();
export const mockLoggerInfo = vi.fn();
export const mockLoggerDebug = vi.fn();
vi.mock('@taskforceai/api-client/auth/logger', () => ({
  getAuthLogger: () => ({
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
  }),
}));

export const mockStoreAuthToken = vi.fn();
export const mockClearAuthToken = vi.fn();
vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  storeAuthToken: (...args: any[]) => mockStoreAuthToken(...args),
  clearAuthToken: (...args: any[]) => mockClearAuthToken(...args),
}));

export const TestConsumer = () => {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="user">{auth.user ? 'logged_in' : 'logged_out'}</div>
      <div data-testid="email">{auth.user?.email ?? ''}</div>
      <div data-testid="authenticated">{auth.isAuthenticated ? 'authenticated' : 'anonymous'}</div>
      <div data-testid="loading">{auth.isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="token-ready">{auth.isTokenReady ? 'ready' : 'waiting'}</div>
      <div data-testid="session-status">{auth.sessionStatus ?? ''}</div>
      <button
        data-testid="force-fail-permanent"
        onClick={() => auth.handleAuthFailure?.('profile_not_found')}
      >
        Permanent Fail
      </button>
      <button
        data-testid="force-fail-transient"
        onClick={() => auth.handleAuthFailure?.('network_error')}
      >
        Transient Fail
      </button>
      <button data-testid="logout" onClick={() => void auth.logout()}>
        Logout
      </button>
      <button data-testid="refresh" onClick={() => void auth.refreshUser({ force: true })}>
        Refresh
      </button>
    </div>
  );
};

export const installAuthHarness = () => {
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
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  return { authStorage, profileStorage, renderAuth };
};

export const advance = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

export const advanceAndFlush = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });

export { authClient, AuthProvider, fetchCurrentUser, useAuth };
export type { AuthProviderConfig };
