import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';

const promptAsync = jest.fn();
const exchangeCodeAsync = jest.fn();
const fetchMock = jest.fn();
const authRequestConfigs: unknown[] = [];
const redirectUriConfigs: unknown[] = [];

const originalFetch = globalThis.fetch;

mock.module('expo-auth-session', () => ({
  __esModule: true,
  ResponseType: { Code: 'code' },
  makeRedirectUri: (config: unknown) => {
    redirectUriConfigs.push(config);
    return 'com.googleusercontent.apps.test-client:/oauth2redirect';
  },
  AuthRequest: class MockAuthRequest {
    codeVerifier = 'verifier';

    constructor(readonly config: unknown) {
      authRequestConfigs.push(config);
    }

    promptAsync = promptAsync;
  },
  exchangeCodeAsync,
}));

mock.module('expo-web-browser', () => ({
  __esModule: true,
  maybeCompleteAuthSession: () => {},
}));

mock.module('../../config/env', () => ({
  __esModule: true,
  getGoogleAndroidClientId: () => envState.androidClientId,
  requireGoogleClientId: () => 'test-client.apps.googleusercontent.com',
}));

const envState = {
  androidClientId: undefined as string | undefined,
};

describe('signInWithGoogle', () => {
  beforeEach(() => {
    promptAsync.mockReset();
    exchangeCodeAsync.mockReset();
    fetchMock.mockReset();
    authRequestConfigs.length = 0;
    redirectUriConfigs.length = 0;
    envState.androidClientId = undefined;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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
    expect(exchangeCodeAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
      })
    );
  });

  it('rejects a successful callback without an authorization code before token exchange', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { state: '00000000000000000000000000000000' },
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('missing authorization code');
    expect(exchangeCodeAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Android client ID and reverse-DNS redirect URI on Android', async () => {
    const { Platform } = await import('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'android';
    envState.androidClientId = 'android-client.apps.googleusercontent.com';
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'person@example.com' }),
    });

    try {
      const { signInWithGoogle } = await import('../../utils/google-oauth');

      await signInWithGoogle();

      expect(authRequestConfigs[0]).toMatchObject({
        clientId: 'android-client.apps.googleusercontent.com',
      });
      expect(redirectUriConfigs[0]).toEqual({
        native: 'com.googleusercontent.apps.android-client:/oauth2redirect',
      });
      expect(exchangeCodeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'android-client.apps.googleusercontent.com',
        }),
        expect.objectContaining({
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
        })
      );
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it('rejects cancelled prompt results before token exchange', async () => {
    promptAsync.mockResolvedValue({ type: 'cancel', params: {} });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('Authentication cancelled or failed');
    expect(exchangeCodeAsync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects failed Google user info responses', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'forbidden' }),
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('Failed to fetch user info');
  });

  it('rejects token exchange results missing an access token', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: '',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ email: 'person@example.com' }),
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('Missing required tokens or user info');
  });

  it('rejects malformed Google user info JSON with a stable error', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('Invalid Google user info response');
  });

  it('rejects invalid Google user info payloads with a stable error', async () => {
    promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code', state: '00000000000000000000000000000000' },
    });
    exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Missing Email' }),
    });

    const { signInWithGoogle } = await import('../../utils/google-oauth');

    await expect(signInWithGoogle()).rejects.toThrow('Invalid Google user info response');
  });
});
