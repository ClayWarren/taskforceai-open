import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';

const promptAsync = jest.fn();
const exchangeCodeAsync = jest.fn();
const fetchMock = jest.fn();

const originalFetch = globalThis.fetch;

mock.module('expo-auth-session', () => ({
  __esModule: true,
  ResponseType: { Code: 'code' },
  makeRedirectUri: () => 'com.googleusercontent.apps.test-client:/oauth2redirect',
  AuthRequest: class MockAuthRequest {
    codeVerifier = 'verifier';

    constructor(readonly config: unknown) {}

    promptAsync = promptAsync;
  },
  exchangeCodeAsync,
}));

mock.module('expo-web-browser', () => ({
  __esModule: true,
  maybeCompleteAuthSession: () => {},
}));

describe('signInWithGoogle', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    promptAsync.mockReset();
    exchangeCodeAsync.mockReset();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  });

  it('rejects a successful callback when the OAuth state does not match', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: 'wrong-state' },
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('state mismatch');
    expect(exchangeCodeAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code only after the OAuth state matches', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'person@example.com', name: 'Person' }),
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      user: { email: 'person@example.com', name: 'Person', picture: '' },
    });
    expect(exchangeCodeAsync).toHaveBeenCalledTimes(1);
  });
});
