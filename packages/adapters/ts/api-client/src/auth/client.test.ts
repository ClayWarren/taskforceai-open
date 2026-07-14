import type { ApiClient } from '@taskforceai/api-client/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { AuthClient, createAuthClient } from './client';
import { getAuthLogger } from './logger';
import { MemoryAuthStorage } from './storage';
import type { AuthenticatedUser, SessionData } from './types';

const baseUser: AuthenticatedUser = {
  id: 1,
  email: 'user@example.com',
  full_name: null,
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
  theme_preference: 'light',
  memory_enabled: true,
  web_search_enabled: true,
  code_execution_enabled: true,
  mfa_enabled: false,
  notifications_enabled: true,
  quick_mode_enabled: false,
  trust_layer_enabled: false,
  customer_id: null,
  disabled: 'false',
  is_admin: false,
  trial_ends_at: null,
};

const createUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  ...baseUser,
  ...overrides,
});

const buildSession = (overrides: Partial<SessionData> = {}): SessionData => ({
  accessToken: 'token',
  expiresAt: Date.now() + 3600000,
  user: {
    id: 1,
    email: 'user@example.com',
    plan: 'free',
    ...overrides.user,
  },
  ...overrides,
});

const expectErrMessage = (result: { ok: boolean; error?: Error }, message: string) => {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error?.message).toBe(message);
  }
};

describe('shared/auth/client', () => {
  type AuthApiClient = Pick<ApiClient, 'logout' | 'currentUser'>;
  let mockApiClient: AuthApiClient;
  let logoutMock: ReturnType<typeof vi.fn>;
  let currentUserMock: ReturnType<typeof vi.fn>;
  let storage: MemoryAuthStorage;
  let authClient: AuthClient;

  beforeEach(() => {
    storage = new MemoryAuthStorage();

    logoutMock = vi.fn<ApiClient['logout']>();
    currentUserMock = vi.fn<ApiClient['currentUser']>();

    mockApiClient = {
      logout: logoutMock,
      currentUser: currentUserMock,
    };

    authClient = new AuthClient({
      apiClient: mockApiClient,
      storage,
    });

    // Suppress logger output during tests
    const logger = getAuthLogger();
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logout', () => {
    it('logs out and clears session', async () => {
      // Set up a session first
      await storage.setSession(buildSession());

      logoutMock.mockResolvedValue(undefined);

      await authClient.logout();

      expect(logoutMock).toHaveBeenCalled();

      const sessionResult = await storage.getSession();
      expectErrMessage(sessionResult, 'No session found');
    });

    it('clears local session even if server logout fails', async () => {
      await storage.setSession(buildSession());

      logoutMock.mockRejectedValue(new Error('Server error'));

      await authClient.logout();

      // Session should still be cleared locally
      const sessionResult = await storage.getSession();
      expectErrMessage(sessionResult, 'No session found');
    });

    it('returns an error when local session clear fails', async () => {
      await storage.setSession(buildSession());
      logoutMock.mockResolvedValue(undefined);
      vi.spyOn(storage, 'clearSession').mockResolvedValueOnce({
        ok: false,
        error: new Error('local storage unavailable'),
      });

      const result = await authClient.logout();

      expectErrMessage(result, 'local storage unavailable');
    });
  });

  describe('getSession', () => {
    it('returns valid session', async () => {
      const sessionData = buildSession({
        accessToken: 'valid-token',
        user: { id: 1, email: 'user@test.com', plan: 'pro' },
      });

      await storage.setSession(sessionData);

      const result = await authClient.getSession();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(sessionData);
      }
    });

    it('returns null when no session exists', async () => {
      const result = await authClient.getSession();
      expectErrMessage(result, 'No session found');
    });

    it('clears and returns null for expired session', async () => {
      const expiredSession = buildSession({
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
        user: { id: 1, email: 'user@test.com', plan: 'free' },
      });

      await storage.setSession(expiredSession);

      const result = await authClient.getSession();
      expectErrMessage(result, 'Session expired');

      // Verify session was cleared
      const storedSessionResult = await storage.getSession();
      expectErrMessage(storedSessionResult, 'No session found');
    });
  });

  describe('getCurrentUser', () => {
    it('fetches current user from server', async () => {
      const mockUser = createUser({
        email: 'test@example.com',
        plan: 'super',
      });

      currentUserMock.mockResolvedValue(mockUser);

      const result = await authClient.getCurrentUser();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(mockUser);
      }
      expect(currentUserMock).toHaveBeenCalled();
    });

    it('returns null and clears session on 401 error', async () => {
      await storage.setSession({
        ...buildSession(),
      });

      const error = Object.assign(new Error('Unauthorized'), { status: 401 });
      currentUserMock.mockRejectedValue(error);

      const result = await authClient.getCurrentUser();
      expectErrMessage(result, 'Unauthorized');

      // Session should be cleared
      const sessionResult = await storage.getSession();
      expectErrMessage(sessionResult, 'No session found');
    });

    it('returns null on other errors without clearing session', async () => {
      await storage.setSession({
        ...buildSession(),
      });

      currentUserMock.mockRejectedValue(new Error('Network error'));

      const result = await authClient.getCurrentUser();
      expectErrMessage(result, 'Network error');

      // Session should NOT be cleared
      const sessionResult = await storage.getSession();
      expect(sessionResult.ok).toBe(true);
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when valid session exists', async () => {
      await storage.setSession({
        ...buildSession(),
      });

      const isAuth = await authClient.isAuthenticated();

      expect(isAuth).toBe(true);
    });

    it('returns false when no session exists', async () => {
      const isAuth = await authClient.isAuthenticated();

      expect(isAuth).toBe(false);
    });

    it('returns false when session is expired', async () => {
      await storage.setSession({
        ...buildSession({ expiresAt: Date.now() - 1000 }),
      });

      const isAuth = await authClient.isAuthenticated();

      expect(isAuth).toBe(false);
    });
  });

  describe('getToken', () => {
    it('returns access token from valid session', async () => {
      await storage.setSession({
        ...buildSession({ accessToken: 'my-token-123' }),
      });

      const result = await authClient.getToken();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('my-token-123');
      }
    });

    it('returns null when no session exists', async () => {
      const result = await authClient.getToken();
      expectErrMessage(result, 'No session found');
    });

    it('returns null when session is expired', async () => {
      await storage.setSession({
        ...buildSession({ accessToken: 'expired-token', expiresAt: Date.now() - 1000 }),
      });

      const result = await authClient.getToken();
      expectErrMessage(result, 'Session expired');
    });
  });

  describe('createAuthClient', () => {
    it('creates an AuthClient instance', () => {
      const client = createAuthClient({
        apiClient: mockApiClient,
        storage: new MemoryAuthStorage(),
      });

      expect(client).toBeInstanceOf(AuthClient);
    });
  });
});
