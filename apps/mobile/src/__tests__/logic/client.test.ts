import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { ok, err } from '@taskforceai/shared/result';

// 1. ACCESS GLOBAL MOCK CONTROLLER
const controller = (globalThis as any).__TEST_MOCKS__;

// 2. DEFINE LOCAL MODULE MOCKS (Only for things not in bun-setup)
const localState = {
  sessionValue: ok({ accessToken: 'mock-token' }) as any
};

mock.module('../../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: mock(async () => localState.sessionValue),
  },
}));

mock.module('@/config/base-url', () => ({
  getMobileBaseUrl: () => 'https://api.test',
}));

// 3. IMPORT THE ACTUAL CODE
import { getMobileClient } from '../../api/client';

describe('Mobile API client bootstrap', () => {
  beforeEach(() => {
    (globalThis as any).__MOBILE_CLIENTS__ = { api: null, auth: null, pinnedFetch: null };
    localState.tokenValue = 'mock-token';
    controller.createApiClient.mockClear();
    controller.createAuthClient.mockClear();
  });

  it('provides cached clients', () => {
    const client1 = getMobileClient();
    expect(controller.createApiClient).toHaveBeenCalled();
    
    const client2 = getMobileClient();
    expect(client1).toBe(client2);
    expect(client1).toBe(controller.apiClient);
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
});
