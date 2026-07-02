import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { ok, err } from '@taskforceai/shared/result';

// 1. ACCESS GLOBAL MOCK CONTROLLER
const controller = (globalThis as any).__TEST_MOCKS__;

// 2. DEFINE LOCAL MODULE MOCKS (Only for things not in bun-setup)
const localState = {
  sessionValue: ok({ accessToken: 'mock-token' }) as any,
  throwOnGetSession: false,
};
const mockSetSession = mock(async () => ok(undefined));
const mockClearSession = mock(async () => ok(undefined));
const mockPinnedFetch = mock(async () => new Response(null, { status: 204 })) as typeof fetch;
const mockCreatePinnedFetch = mock(() => mockPinnedFetch);

mock.module('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: mock(async () => {
      if (localState.throwOnGetSession) {
        throw new Error('storage unavailable');
      }
      return localState.sessionValue;
    }),
    setSession: mockSetSession,
    clearSession: mockClearSession,
  },
}));

mock.module('@/config/base-url', () => ({
  getMobileBaseUrl: () => 'https://api.test',
}));

mock.module('../../security/certificate-pinning', () => ({
  createPinnedFetch: mockCreatePinnedFetch,
}));

// 3. IMPORT THE ACTUAL CODE
import { getMobileAuthClient, getMobileClient, getMobilePinnedFetch } from '../../api/client';

describe('Mobile API client bootstrap', () => {
  beforeEach(() => {
    (globalThis as any).__MOBILE_CLIENTS__ = { api: null, auth: null, pinnedFetch: null };
    localState.sessionValue = ok({ accessToken: 'mock-token' });
    localState.throwOnGetSession = false;
    controller.createApiClient.mockClear();
    controller.createAuthClient.mockClear();
    mockCreatePinnedFetch.mockClear();
    mockSetSession.mockClear();
    mockClearSession.mockClear();
  });

  it('provides cached clients', () => {
    const client1 = getMobileClient();
    expect(controller.createApiClient).toHaveBeenCalled();

    const client2 = getMobileClient();
    expect(client1).toBe(client2);
    expect(client1).toBe(controller.apiClient);
  });

  it('caches the pinned fetch used by API clients', () => {
    const fetch1 = getMobilePinnedFetch();
    const fetch2 = getMobilePinnedFetch();
    const client = getMobileClient() as any;

    expect(fetch1).toBe(mockPinnedFetch);
    expect(fetch2).toBe(fetch1);
    expect(mockCreatePinnedFetch).toHaveBeenCalledTimes(1);
    expect(client.config.fetchImpl).toBe(fetch1);
  });

  it('provides a cached auth client backed by mobile session storage', async () => {
    const auth1 = getMobileAuthClient();
    const auth2 = getMobileAuthClient();

    expect(auth1).toBe(auth2);
    expect(controller.createAuthClient).toHaveBeenCalledTimes(1);
    expect(controller.authClient.apiClient).toBe(controller.apiClient);

    const firstCall = controller.createAuthClient.mock.calls[0];
    if (!firstCall) {
      throw new Error('createAuthClient was not called');
    }
    const storage = firstCall[0].storage;
    await storage.setSession({ accessToken: 'next-token' });
    await storage.clearSession();

    localState.sessionValue = ok({ accessToken: 'auth-token' });
    await expect(storage.getToken()).resolves.toEqual(ok('auth-token'));

    localState.sessionValue = err(new Error('Missing'));
    const missingToken = await storage.getToken();
    expect(missingToken.ok).toBe(false);
    expect(mockSetSession).toHaveBeenCalledWith({ accessToken: 'next-token' });
    expect(mockClearSession).toHaveBeenCalled();
  });

  it('resolveTokenFromStorage handles various Return types from storage', async () => {
    const client = getMobileClient() as any;
    const config = client.config;
    if (!config || !config.getToken) return;
    const getToken = config.getToken;

    localState.sessionValue = ok({ accessToken: 'token-123' });
    let res = await getToken();
    expect(res.ok).toBe(true);
    expect(res.value).toBe('token-123');

    localState.sessionValue = err(new Error('Missing'));
    res = await getToken();
    expect(res.ok).toBe(false);
  });

  it('maps storage exceptions to TOKEN_UNAVAILABLE for API token lookup', async () => {
    const client = getMobileClient() as any;
    const config = client.config;
    if (!config || !config.getToken) return;

    localState.throwOnGetSession = true;

    await expect(config.getToken()).resolves.toEqual(err('TOKEN_UNAVAILABLE'));
  });
});
