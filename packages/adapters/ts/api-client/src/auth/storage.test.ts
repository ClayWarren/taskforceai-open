import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { LocalStorageAuthStorage, MemoryAuthStorage } from './storage';
import type { SessionData } from './types';

const sessionData = (overrides: Partial<SessionData> = {}): SessionData => ({
  accessToken: 'test-token',
  expiresAt: Date.now() + 3600000,
  user: {
    id: 1,
    email: 'test@example.com',
    plan: 'free',
  },
  ...overrides,
});

const expectErrMessage = (result: { ok: boolean; error?: Error }, message?: string) => {
  expect(result.ok).toBe(false);
  if (message && !result.ok) {
    expect(result.error?.message).toBe(message);
  }
};

const expectOkValue = <T>(result: { ok: true; value: T } | { ok: false }, value: T) => {
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(value);
  }
};

describe('shared/auth/storage', () => {
  describe('MemoryAuthStorage', () => {
    let storage: MemoryAuthStorage;

    beforeEach(() => {
      storage = new MemoryAuthStorage();
    });

    it('returns null when no session exists', async () => {
      const session = await storage.getSession();
      expectErrMessage(session);
    });

    it('stores and retrieves session', async () => {
      const session = sessionData();

      await storage.setSession(session);
      const retrieved = await storage.getSession();

      expectOkValue(retrieved, session);
    });

    it('clears session', async () => {
      await storage.setSession(
        sessionData({ user: { id: 1, email: 'test@example.com', plan: 'pro' } })
      );
      await storage.clearSession();

      const retrieved = await storage.getSession();
      expectErrMessage(retrieved);
    });

    it('gets token from session', async () => {
      const session = sessionData({
        accessToken: 'test-token-123',
        user: {
          id: 1,
          email: 'test@example.com',
          plan: 'super',
        },
      });

      await storage.setSession(session);
      const token = await storage.getToken();

      expectOkValue(token, 'test-token-123');
    });

    it('returns null token when no session', async () => {
      const token = await storage.getToken();
      expectErrMessage(token);
    });

    it('overwrites existing session', async () => {
      const session1 = sessionData({
        accessToken: 'token1',
        user: { id: 1, email: 'user1@test.com', plan: 'free' },
      });

      const session2 = sessionData({
        accessToken: 'token2',
        expiresAt: Date.now() + 7200000,
        user: { id: 2, email: 'user2@test.com', plan: 'pro' },
      });

      await storage.setSession(session1);
      await storage.setSession(session2);

      const retrieved = await storage.getSession();
      expectOkValue(retrieved, session2);
    });
  });

  describe('LocalStorageAuthStorage', () => {
    let storage: LocalStorageAuthStorage;
    let mockLocalStorage: Record<string, string>;
    let mockStorage: Storage;

    beforeEach(() => {
      mockLocalStorage = {};

      mockStorage = {
        getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          mockLocalStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockLocalStorage[key];
        }),
        clear: vi.fn(() => {
          Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
        }),
        length: 0,
        key: vi.fn(() => null),
      };

      global.window = {
        localStorage: mockStorage,
      } as unknown as Window & typeof globalThis;

      Object.defineProperty(global, 'localStorage', {
        value: mockStorage,
        writable: true,
        configurable: true,
      });

      storage = new LocalStorageAuthStorage();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // @ts-expect-error - cleaning up mock
      delete global.window;
      // @ts-expect-error - cleaning up mock
      delete global.localStorage;
    });

    it('returns null when localStorage is unavailable', async () => {
      // @ts-expect-error - testing undefined window
      delete global.window;
      storage = new LocalStorageAuthStorage();

      const session = await storage.getSession();
      expectErrMessage(session);
    });

    it('stores and retrieves session', async () => {
      const session = sessionData();

      await storage.setSession(session);
      const retrieved = await storage.getSession();

      expectOkValue(retrieved, session);
    });

    it('accepts admin plan in stored sessions', async () => {
      const session = sessionData({
        accessToken: 'admin-token',
        user: {
          id: 99,
          email: 'admin@example.com',
          plan: 'admin',
        },
      });

      await storage.setSession(session);
      const retrieved = await storage.getSession();

      expectOkValue(retrieved, session);
    });

    it('accepts string user ids in stored sessions', async () => {
      const session = sessionData({
        accessToken: 'string-id-token',
        user: {
          id: 'user-123',
          email: 'user-123@example.com',
          plan: 'free',
        },
      });

      await storage.setSession(session);
      const retrieved = await storage.getSession();

      expectOkValue(retrieved, session);
    });

    it('does not write legacy token keys when saving session', async () => {
      const session = sessionData({
        accessToken: 'legacy-token',
        user: {
          id: 1,
          email: 'test@example.com',
          plan: 'pro',
        },
      });

      await storage.setSession(session);

      expect(mockLocalStorage['@taskforceai:token']).toBeUndefined();
      expect(mockLocalStorage['authToken']).toBeUndefined();
    });

    it('does not revive legacy token-only storage as a session', async () => {
      delete mockLocalStorage['@taskforceai:session'];
      mockLocalStorage['@taskforceai:token'] = 'legacy-token-123';

      const session = await storage.getSession();

      expectErrMessage(session, 'No session found');
      expect(mockLocalStorage['@taskforceai:token']).toBe('legacy-token-123');
    });

    it('prefers session storage over legacy token', async () => {
      const storedSession = sessionData({
        accessToken: 'new-token',
        user: {
          id: 1,
          email: 'test@example.com',
          plan: 'super',
        },
      });

      mockLocalStorage['@taskforceai:session'] = JSON.stringify(storedSession);
      mockLocalStorage['@taskforceai:token'] = 'old-token';

      const session = await storage.getSession();

      expect(session.ok && session.value.accessToken).toBe('new-token');
    });

    it('does not revive the older authToken key as a session', async () => {
      delete mockLocalStorage['@taskforceai:session'];
      delete mockLocalStorage['@taskforceai:token'];
      mockLocalStorage['authToken'] = 'very-old-token';

      const session = await storage.getSession();

      expectErrMessage(session, 'No session found');
      expect(mockLocalStorage['authToken']).toBe('very-old-token');
    });

    it('clears all session and legacy keys', async () => {
      await storage.setSession(sessionData());
      await storage.clearSession();

      expect(mockLocalStorage['@taskforceai:session']).toBeUndefined();
      expect(mockLocalStorage['@taskforceai:token']).toBeUndefined();
      expect(mockLocalStorage['authToken']).toBeUndefined();
    });

    it('handles JSON parse errors gracefully', async () => {
      mockLocalStorage['@taskforceai:session'] = 'invalid-json{';

      const session = await storage.getSession();

      expectErrMessage(session);
    });

    it('clears malformed structured sessions instead of falling back to legacy token', async () => {
      mockLocalStorage['@taskforceai:session'] = JSON.stringify({
        accessToken: 'invalid-shape-token',
        // Missing required fields in schema; this session should be rejected.
      });
      mockLocalStorage['@taskforceai:token'] = 'legacy-token';

      const session = await storage.getSession();

      expectErrMessage(session, 'Session validation failed');
      expect(mockLocalStorage['@taskforceai:session']).toBeUndefined();
      expect(mockLocalStorage['@taskforceai:token']).toBe('legacy-token');
    });

    it('returns errors when localStorage throws during getSession', async () => {
      const storageError = new Error('localStorage read failed');
      (mockStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw storageError;
      });

      const session = await storage.getSession();

      expectErrMessage(session, 'localStorage read failed');
    });

    it('gets token through getToken method', async () => {
      const session = sessionData({
        accessToken: 'test-token-456',
      });

      await storage.setSession(session);
      const token = await storage.getToken();

      expectOkValue(token, 'test-token-456');
    });

    it('does nothing when window is undefined during setSession', async () => {
      // @ts-expect-error - testing undefined window
      delete global.window;
      storage = new LocalStorageAuthStorage();

      const session = sessionData({
        accessToken: 'test-token',
      });

      await storage.setSession(session);
      // Should not throw
    });

    it('does nothing when window is undefined during clearSession', async () => {
      // @ts-expect-error - testing undefined window
      delete global.window;
      storage = new LocalStorageAuthStorage();

      await storage.clearSession();
      // Should not throw
    });

    it('returns an error when localStorage throws during setSession', async () => {
      const storageError = new Error('localStorage write failed');
      (mockStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw storageError;
      });

      const result = await storage.setSession({
        ...sessionData(),
        accessToken: 'test-token',
      });

      expectErrMessage(result, 'localStorage write failed');
    });
  });
});
