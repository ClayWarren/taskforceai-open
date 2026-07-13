import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { type Result, err, ok } from '@taskforceai/client-core/result';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import type { SessionData } from '@taskforceai/api-client/auth';

// Mock contracts auth-client (used by shared AuthProvider)
const mockContractsAuthClient = {
  getSession: jest.fn(() => Promise.resolve(null)),
  getToken: jest.fn(() => Promise.resolve(null)),
  signIn: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
};

jest.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: mockContractsAuthClient,
}));

// Mock auth-service loadUserProfile
const mockLoadUserProfile = jest.fn(() => 
  Promise.resolve(err(new Error('No user')))
);

jest.mock('@taskforceai/api-client/auth/auth-service', () => ({
  loadUserProfile: () => mockLoadUserProfile(),
  buildUserState: (user: Partial<AuthenticatedUser>) => user,
}));

// Use sqliteStorage mock
jest.mock('../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: jest.fn(),
    loadProfile: jest.fn(),
    saveProfile: jest.fn(),
    clearSession: jest.fn(),
    clearProfile: jest.fn(),
    clearAll: jest.fn(),
    getToken: jest.fn(),
  },
}));
import { sqliteStorage } from '../storage/sqlite-adapter';

type AuthClientLike = {
  logout: () => Promise<Result<void>>;
  getCurrentUser: () => Promise<Result<AuthenticatedUser>>;
  getSession: () => Promise<Result<SessionData>>;
  getToken: () => Promise<Result<string>>;
  isAuthenticated: () => Promise<boolean>;
};

const mockAuthClient: jest.Mocked<AuthClientLike> = {
  logout: jest.fn(),
  getCurrentUser: jest.fn(),
  getSession: jest.fn(),
  getToken: jest.fn(),
  isAuthenticated: jest.fn(),
};

jest.mock('@/api/client', () => ({
  __esModule: true,
  getMobileAuthClient: () => mockAuthClient,
  getMobileClient: () => mockAuthClient,
}));
jest.mock('../api/client', () => ({
  __esModule: true,
  getMobileAuthClient: () => mockAuthClient,
  getMobileClient: () => mockAuthClient,
}));

jest.mock('@/notifications/registration', () => ({
  unregisterPushNotifications: jest.fn(async () => {}),
}));
jest.mock('../notifications/registration', () => ({
  unregisterPushNotifications: jest.fn(async () => {}),
}));

const mockClearAllDesktopPairingSessions = jest.fn(async () => undefined);
const mockClearAuthToken = jest.fn(async () => undefined);
const mockCanUseE2EAuthSeed = jest.fn(() => false);
const mockSeedE2EAuthSession = jest.fn(async () => undefined);
const mockMobileLoggerError = jest.fn();

jest.mock('../desktop-pairing/session-store', () => ({
  clearAllDesktopPairingSessions: () => mockClearAllDesktopPairingSessions(),
}));

jest.mock('../auth/token-store', () => ({
  clearAuthToken: () => mockClearAuthToken(),
}));

jest.mock('../auth/e2e-session-seed', () => ({
  canUseE2EAuthSeed: () => mockCanUseE2EAuthSeed(),
  seedE2EAuthSession: () => mockSeedE2EAuthSession(),
}));

jest.mock('../logger', () => ({
  mobileLogger: { error: (...args: unknown[]) => mockMobileLoggerError(...args) },
  createModuleLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('expo-modules-core', () => ({}));
jest.mock('expo-modules-core/src/polyfill/dangerous-internal', () => ({}));

import { AuthProvider, useAuth } from '../contexts/AuthContext';

type AuthContextValue = ReturnType<typeof useAuth>;

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const buildUser = (overrides: Partial<AuthenticatedUser>): AuthenticatedUser => ({
  email: '',
  full_name: null,
  plan: 'free',
  message_count: 0,
  last_message_timestamp: null,
  subscription_id: null,
  subscription_status: null,
  subscription_source: null,
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  theme_preference: 'dark',
  customer_id: null,
  disabled: 'false',
  is_admin: false,
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  notifications_enabled: true,
  quick_mode_enabled: false,
  impersonator_id: undefined,
  ...overrides,
});

const sqliteMock = sqliteStorage as jest.Mocked<typeof sqliteStorage>;

const resetState = () => {
  jest.clearAllMocks();
  
  // Default behaviors for sqliteStorage mock
  sqliteMock.loadProfile.mockResolvedValue(ok(null));
  sqliteMock.saveProfile.mockResolvedValue(ok(undefined));
  sqliteMock.clearSession.mockResolvedValue(ok(undefined));
  sqliteMock.clearProfile.mockResolvedValue(ok(undefined));
  sqliteMock.clearAll.mockResolvedValue(undefined);
  sqliteMock.getSession.mockResolvedValue(err(new Error('No session')));
  sqliteMock.getToken.mockResolvedValue(err(new Error('No token')));
  mockClearAllDesktopPairingSessions.mockResolvedValue(undefined);
  mockClearAuthToken.mockResolvedValue(undefined);
  mockCanUseE2EAuthSeed.mockReturnValue(false);
  mockSeedE2EAuthSession.mockResolvedValue(undefined);
  
  mockAuthClient.getSession.mockResolvedValue(err(new Error('No session')));
  mockAuthClient.getCurrentUser.mockResolvedValue(err(new Error('No user')));
  
  // Default: loadUserProfile fails
  mockLoadUserProfile.mockResolvedValue(err(new Error('No user')));
};

const createAuthHarness = async (): Promise<{
  renderer: TestRenderer.ReactTestRenderer;
  getValue: () => AuthContextValue;
  queryClient: QueryClient;
}> => {
  let latestValue: AuthContextValue | null = null;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  const Consumer: React.FC = () => {
    latestValue = useAuth();
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </QueryClientProvider>
    );
  });

  await flushEffects();

  if (!latestValue) {
    throw new Error('Auth context did not initialize');
  }

  return {
    renderer: renderer!,
    getValue: () => latestValue!,
    queryClient,
  };
};

const cleanupRenderer = async (renderer: TestRenderer.ReactTestRenderer, queryClient: QueryClient): Promise<void> => {
  await act(async () => {
    queryClient.clear();
    renderer.unmount();
  });
  await flushEffects();
};

describe('AuthContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetState();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The shared AuthProvider loads profile from profileStorage during bootstrap.
  // It also checks auth via authStorage.getSession(). Both need to be mocked.
  it('initializes from cached profile', async () => {
    const cachedUser = buildUser({ email: 'cached@example.com' });
    
    // Profile is loaded from profileStorage (sqlite)
    sqliteMock.loadProfile.mockResolvedValue(ok(cachedUser));
    
    // Session check via authStorage (sqlite) - return valid session
    sqliteMock.getSession.mockResolvedValue(
      ok({
        accessToken: 'valid-token',
        expiresAt: Date.now() + 3600000,
        user: { id: '1', email: 'cached@example.com', plan: 'free' },
      })
    );
    
    // loadUserProfile should return the user when validating token
    mockLoadUserProfile.mockResolvedValue(ok(cachedUser));

    const { renderer, getValue, queryClient } = await createAuthHarness();
    
    // Wait for bootstrap effect
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    
    // User should be loaded from cached profile
    expect(getValue().user?.email).toBe('cached@example.com');
    expect(getValue().isAuthenticated).toBe(true);

    await cleanupRenderer(renderer, queryClient);
  });

  // The shared AuthProvider handles 401 errors via handleAuthFailure when
  // the session becomes invalid. Test that logout clears session properly.
  it('clears session on logout', async () => {
    const testUser = buildUser({ email: 'test@ex.com' });
    
    // Set up authenticated state via authStorage (sqlite)
    sqliteMock.getSession.mockResolvedValue(
      ok({
        accessToken: 'valid-token',
        expiresAt: Date.now() + 3600000,
        user: { id: '1', email: 'test@ex.com', plan: 'free' },
      })
    );
    sqliteMock.loadProfile.mockResolvedValue(ok(testUser));
    
    // loadUserProfile should return the user when validating token
    mockLoadUserProfile.mockResolvedValue(ok(testUser));

    const { renderer, getValue, queryClient } = await createAuthHarness();
    
    // Wait for bootstrap
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    // Should be authenticated
    expect(getValue().isAuthenticated).toBe(true);

    // Logout should clear session
    await act(async () => {
      await getValue().logout();
    });

    expect(sqliteMock.clearSession).toHaveBeenCalled();
    expect(getValue().isAuthenticated).toBe(false);

    await cleanupRenderer(renderer, queryClient);
  });

  it('handles logout failures gracefully', async () => {
    sqliteMock.getSession.mockResolvedValue(
      ok({
        accessToken: 'token',
        expiresAt: Date.now() + 1000,
        user: { id: '1', email: 'test@ex.com', plan: 'free' },
      })
    );
    mockAuthClient.logout.mockRejectedValue(new Error('Logout failed'));
    
    const { renderer, getValue, queryClient } = await createAuthHarness();
    
    await act(async () => {
      await getValue().logout();
    });
    
    // Even if it fails, it should clear local state
    expect(getValue().isAuthenticated).toBe(false);
    expect(sqliteMock.clearSession).toHaveBeenCalled();
    expect(mockClearAllDesktopPairingSessions).toHaveBeenCalled();

    await cleanupRenderer(renderer, queryClient);
  });

  it('refreshUser triggers query invalidation', async () => {
    sqliteMock.getSession.mockResolvedValue(
      ok({
        accessToken: 'token',
        expiresAt: Date.now() + 1000,
        user: { id: '1', email: 'test@ex.com', plan: 'free' },
      })
    );
    const { renderer, getValue, queryClient } = await createAuthHarness();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await getValue().refreshUser();
    });
    expect(invalidateSpy).toHaveBeenCalled();

    // Test with force option when no session
    sqliteMock.getSession.mockResolvedValue(err(new Error('No session')));
    const { renderer: renderer2, getValue: getValue2, queryClient: queryClient2 } = await createAuthHarness();
    const invalidateSpy2 = jest.spyOn(queryClient2, 'invalidateQueries');
    
    await act(async () => {
      await getValue2().refreshUser({ force: true });
    });
    expect(invalidateSpy2).toHaveBeenCalled();

    await cleanupRenderer(renderer, queryClient);
    await cleanupRenderer(renderer2, queryClient2);
  });

  it('clears local user data on bootstrap if the session is expired', async () => {
    sqliteMock.loadProfile.mockResolvedValue(ok(buildUser({ email: 'stale@ex.com' })));
    sqliteMock.getSession.mockResolvedValue(err(new Error('Session expired')));
    
    const { renderer, getValue, queryClient } = await createAuthHarness();
    
    expect(getValue().isAuthenticated).toBe(false);
    expect(sqliteMock.clearSession).toHaveBeenCalled();
    expect(sqliteMock.clearAll).toHaveBeenCalled();

    await cleanupRenderer(renderer, queryClient);
  });

  it('logout clears cache', async () => {
    const cachedUser = buildUser({ email: 'session@example.com' });
    sqliteMock.loadProfile.mockResolvedValue(ok(cachedUser));
    sqliteMock.getSession.mockResolvedValue(
      ok({
        accessToken: 'token',
        expiresAt: Date.now() + 1000,
        user: { id: '1', email: cachedUser.email, plan: 'free' },
      })
    );
    mockAuthClient.getCurrentUser.mockResolvedValue(ok(cachedUser));
    mockAuthClient.logout.mockResolvedValue(ok(undefined));
    
    const { renderer, getValue, queryClient } = await createAuthHarness();
    
    await act(async () => {
      await getValue().logout();
    });
    await flushEffects();

    expect(getValue().isAuthenticated).toBe(false);
    expect(sqliteMock.clearSession).toHaveBeenCalled();

    await cleanupRenderer(renderer, queryClient);
  });

  it('logs rejected local cleanup operations without blocking expired-session recovery', async () => {
    sqliteMock.loadProfile.mockResolvedValue(ok(buildUser({ email: 'stale@ex.com' })));
    sqliteMock.getSession.mockResolvedValue(err(new Error('Session expired')));
    sqliteMock.clearAll.mockRejectedValueOnce(new Error('database cleanup failed'));

    const { renderer, queryClient } = await createAuthHarness();

    expect(mockMobileLoggerError).toHaveBeenCalledWith(
      '[AuthContext] Failed to clear mobile user-local state',
      { error: expect.any(Error) }
    );
    await cleanupRenderer(renderer, queryClient);
  });

  it('seeds simulator auth before rendering children and recovers from seed failure', async () => {
    mockCanUseE2EAuthSeed.mockReturnValue(true);
    mockSeedE2EAuthSession.mockRejectedValueOnce(new Error('seed failed'));
    let renderer!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider><Text>seeded child</Text></AuthProvider>
        </QueryClientProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockMobileLoggerError).toHaveBeenCalledWith(
      '[E2EAuthSeed] Failed to seed simulator auth session',
      { error: expect.any(Error) }
    );
    expect(renderer.root.findByType(Text).props.children).toBe('seeded child');
    renderer.unmount();
  });

  it('does not finish a pending auth seed after the provider unmounts', async () => {
    mockCanUseE2EAuthSeed.mockReturnValue(true);
    let resolveSeed!: () => void;
    mockSeedE2EAuthSession.mockReturnValueOnce(
      new Promise<void>((resolve) => { resolveSeed = resolve; })
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider><Text>pending child</Text></AuthProvider>
        </QueryClientProvider>
      );
    });
    act(() => renderer.unmount());

    await act(async () => { resolveSeed(); await Promise.resolve(); });

    expect(mockSeedE2EAuthSession).toHaveBeenCalled();
  });


  it('throws error when used outside provider', async () => {
    const BareConsumer: React.FC = () => {
      useAuth();
      return null;
    };

    class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
      override state: { error: Error | null } = { error: null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      override render() {
        return this.state.error ? null : this.props.children;
      }
    }

    const queryClient = new QueryClient();
    await act(async () => {
      TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <BareConsumer />
          </ErrorBoundary>
        </QueryClientProvider>
      );
    });
    queryClient.clear();
  });
});
