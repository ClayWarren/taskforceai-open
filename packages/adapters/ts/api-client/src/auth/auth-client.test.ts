import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { authClient } from './auth-client';
import { getAuthLogger } from './logger';

type MockFn = ReturnType<typeof vi.fn> & {
  mock: { calls: unknown[][] };
  mockResolvedValueOnce: (value: Response) => MockFn;
};

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch & MockFn =>
  Object.assign(vi.fn(impl), { preconnect: vi.fn() }) as typeof fetch & MockFn;

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const installFetchResponses = (...responses: Response[]) => {
  const fetchMock = createFetchMock(async () => responses.shift() ?? new Response('{}'));
  globalThis.fetch = fetchMock;
  return fetchMock;
};

const fetchCalls = (fetchMock: MockFn) => fetchMock.mock.calls;

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalNextPublicApiUrl = process.env['NEXT_PUBLIC_API_URL'];
const originalNextPublicAuthUrl = process.env['NEXT_PUBLIC_AUTH_URL'];

const setTestWindow = (origin: string) => {
  const parsed = new URL(origin);
  const location = {
    origin: parsed.origin,
    hostname: parsed.hostname,
    href: parsed.origin,
  } as unknown as Location;
  globalThis.window = { location } as unknown as Window & typeof globalThis;
};

describe('shared/auth/auth-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authClient.configure({
      baseUrl: undefined,
      getTokenProvider: undefined,
      fetchImpl: undefined,
    });
    const logger = getAuthLogger();
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (typeof originalNextPublicApiUrl === 'undefined') {
      delete process.env['NEXT_PUBLIC_API_URL'];
    } else {
      process.env['NEXT_PUBLIC_API_URL'] = originalNextPublicApiUrl;
    }
    if (typeof originalNextPublicAuthUrl === 'undefined') {
      delete process.env['NEXT_PUBLIC_AUTH_URL'];
    } else {
      process.env['NEXT_PUBLIC_AUTH_URL'] = originalNextPublicAuthUrl;
    }
    if (typeof originalWindow === 'undefined') {
      // @ts-expect-error - deleting test-injected window
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    authClient.configure({
      baseUrl: undefined,
      getTokenProvider: undefined,
      fetchImpl: undefined,
    });
    vi.restoreAllMocks();
  });

  describe('getSignInUrl', () => {
    it('normalizes configured base URL without duplicate slashes', () => {
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat/' });

      const signInUrl = authClient.getSignInUrl();

      expect(signInUrl).toContain('https://auth.taskforceai.chat/api/v1/auth/login');
      expect(signInUrl).not.toContain('//api/v1/auth/login');
    });

    it('uses the production auth host for trusted TaskForce browser hostnames', () => {
      setTestWindow('https://app.taskforceai.chat');

      const signInUrl = authClient.getSignInUrl({ callbackUrl: '/settings' });

      const parsed = new URL(signInUrl);
      expect(parsed.origin).toBe('https://auth.taskforceai.chat');
      expect(parsed.pathname).toBe('/api/v1/auth/login');
      expect(parsed.searchParams.get('callbackUrl')).toBe('/settings');
    });

    it('uses relative sign-in paths for untrusted browser hostnames without an auth URL', () => {
      setTestWindow('https://preview.example.test');

      const signInUrl = authClient.getSignInUrl({ callbackUrl: '/settings' });

      expect(signInUrl).toBe('/api/v1/auth/login?callbackUrl=%2Fsettings');
    });

    it('uses the trimmed auth environment URL for server-side sign-in URLs', () => {
      delete (globalThis as { window?: unknown }).window;
      process.env['NEXT_PUBLIC_AUTH_URL'] = ' https://auth.taskforceai.chat/// ';

      const signInUrl = authClient.getSignInUrl({ callbackUrl: '/settings' });

      expect(signInUrl).toBe(
        'https://auth.taskforceai.chat/api/v1/auth/login?callbackUrl=%2Fsettings'
      );
    });

    it('uses import.meta env when process env is unavailable', () => {
      delete (globalThis as { window?: unknown }).window;
      const originalProcessForTest = globalThis.process;
      const importMetaEnv = (import.meta as unknown as { env: Record<string, string | undefined> })
        .env;
      const originalImportMetaAuthUrl = importMetaEnv['NEXT_PUBLIC_AUTH_URL'];
      try {
        // @ts-expect-error - simulating non-Node browser-like bundler globals
        globalThis.process = undefined;
        importMetaEnv['NEXT_PUBLIC_AUTH_URL'] = ' https://auth.taskforceai.chat/// ';

        const signInUrl = authClient.getSignInUrl({ callbackUrl: '/settings' });

        expect(signInUrl).toBe(
          'https://auth.taskforceai.chat/api/v1/auth/login?callbackUrl=%2Fsettings'
        );
      } finally {
        globalThis.process = originalProcessForTest;
        if (originalImportMetaAuthUrl === undefined) {
          delete importMetaEnv['NEXT_PUBLIC_AUTH_URL'];
        } else {
          importMetaEnv['NEXT_PUBLIC_AUTH_URL'] = originalImportMetaAuthUrl;
        }
      }
    });

    it('falls back to root callback when callback URL is cross-origin', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: 'https://attacker.example/phishing',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('rejects backslash-prefixed callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '/\\evil.example/callback',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('rejects protocol-relative callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '//attacker.example/callback',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('rejects unsupported callback URL protocols', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: 'ftp://app.taskforceai.chat/settings',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('rejects absolute callback URLs when no browser origin is available', () => {
      delete (globalThis as { window?: unknown }).window;
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: 'https://app.taskforceai.chat/settings',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('rejects malformed absolute callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: 'https://%',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/');
    });

    it('strips query and hash from same-origin callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const callbackUrl = 'https://app.taskforceai.chat/settings?tab=security#danger-zone';
      const signInUrl = authClient.getSignInUrl({ callbackUrl });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('https://app.taskforceai.chat/settings');
    });

    it('strips query and hash from root-relative callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '/billing?inviteToken=secret#section',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/billing');
    });

    it('preserves safe upgrade plan callbacks while stripping other query data', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '/billing?inviteToken=secret&plan=pro#section',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/billing?plan=pro');
    });

    it('drops unsupported plan callback values', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '/billing?plan=enterprise',
      });

      const parsed = new URL(signInUrl);
      expect(parsed.searchParams.get('callbackUrl')).toBe('/billing');
    });
  });

  describe('getSession', () => {
    it('uses configured fetch implementation', async () => {
      const fetchMock = installFetchResponses(
        jsonResponse({
          user: { email: 'test@example.com' },
          expires: '2099-01-01T00:00:00.000Z',
        })
      );
      const customFetch = createFetchMock(async () =>
        jsonResponse({
          user: { email: 'custom@example.com' },
          expires: '2099-01-01T00:00:00.000Z',
        })
      );
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        fetchImpl: customFetch,
      });

      const session = await authClient.getSession();

      expect(session?.user?.email).toBe('custom@example.com');
      expect(customFetch).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses configured base URL directly for server-side session checks', async () => {
      delete (globalThis as { window?: unknown }).window;
      process.env['NEXT_PUBLIC_API_URL'] = 'https://env.taskforceai.chat';

      const fetchMock = installFetchResponses(
        jsonResponse({
          user: { email: 'test@example.com' },
          expires: '2099-01-01T00:00:00.000Z',
        })
      );
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
      });

      const session = await authClient.getSession();

      expect(session?.user?.email).toBe('test@example.com');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchCalls(fetchMock)[0]!;
      expect(url).toBe('https://auth.taskforceai.chat/api/auth/session');
    });

    it('uses the server API environment URL when no base URL is configured', async () => {
      delete (globalThis as { window?: unknown }).window;
      process.env['NEXT_PUBLIC_API_URL'] = ' https://api.taskforceai.chat/// ';
      const fetchMock = installFetchResponses(
        jsonResponse({
          user: { email: 'test@example.com' },
          expires: '2099-01-01T00:00:00.000Z',
        })
      );

      const session = await authClient.getSession();

      expect(session?.user?.email).toBe('test@example.com');
      const [url] = fetchCalls(fetchMock)[0]!;
      expect(url).toBe('https://api.taskforceai.chat/api/auth/session');
    });

    it('returns null when the session endpoint responds with an error status', async () => {
      installFetchResponses(jsonResponse({ error: 'unauthorized' }, { status: 401 }));
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(authClient.getSession()).resolves.toBeNull();
    });

    it('returns null when session payload is missing user email', async () => {
      const fetchMock = installFetchResponses(
        jsonResponse({
          user: { name: 'No Email' },
          expires: '2099-01-01T00:00:00.000Z',
        })
      );
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        getTokenProvider: async () => 'provider-token',
      });

      const session = await authClient.getSession();

      expect(session).toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Session response failed validation', {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: 'user.email',
          }),
        ]),
      });
      const [, init] = fetchCalls(fetchMock)[0]!;
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('Authorization')).toBe('Bearer provider-token');
    });

    it('returns null when session payload omits expiry metadata', async () => {
      installFetchResponses(
        jsonResponse({
          user: { email: 'test@example.com' },
        })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const session = await authClient.getSession();

      expect(session).toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Session response failed validation', {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: 'expires',
          }),
        ]),
      });
    });

    it('returns null when the session response JSON is malformed', async () => {
      installFetchResponses({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const session = await authClient.getSession();

      expect(session).toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Session response JSON parsing failed', {
        error: expect.any(SyntaxError),
      });
    });

    it('returns null when token provider throws before request', async () => {
      const fetchMock = installFetchResponses(
        jsonResponse({ user: { email: 'test@example.com' } })
      );
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        getTokenProvider: async () => {
          throw new Error('Token provider unavailable');
        },
      });

      const session = await authClient.getSession();

      expect(session).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs network session failures as debug and unexpected failures as warnings', async () => {
      const networkFetch = createFetchMock(async () => {
        throw new TypeError('offline');
      });
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        fetchImpl: networkFetch,
      });

      await expect(authClient.getSession()).resolves.toBeNull();
      expect(getAuthLogger().debug).toHaveBeenCalledWith(
        'Session check bypassed (network/aborted)',
        { error: expect.any(TypeError) }
      );

      const unexpectedFetch = createFetchMock(async () => {
        throw new Error('boom');
      });
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        fetchImpl: unexpectedFetch,
      });

      await expect(authClient.getSession()).resolves.toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Failed to fetch session', {
        error: expect.any(Error),
      });
    });
  });

  describe('getToken', () => {
    it('uses the same-origin auth proxy for browser token reads', async () => {
      setTestWindow('https://console.taskforceai.chat');
      process.env['NEXT_PUBLIC_AUTH_URL'] = 'https://auth.taskforceai.chat';
      const fetchMock = installFetchResponses(jsonResponse({ accessToken: 'proxy-token' }));

      const token = await authClient.getToken();

      expect(token).toBe('proxy-token');
      expect(fetchCalls(fetchMock)[0]?.[0]).toBe('/api/v1/auth/token');
    });

    it('uses configured token provider and bypasses token endpoint', async () => {
      const fetchMock = installFetchResponses(jsonResponse({ accessToken: 'network-token' }));
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        getTokenProvider: async () => 'provider-token',
      });

      const token = await authClient.getToken();

      expect(token).toBe('provider-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts snake_case access_token payloads', async () => {
      installFetchResponses(jsonResponse({ access_token: 'snake-case-token' }));
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const token = await authClient.getToken();

      expect(token).toBe('snake-case-token');
    });

    it('returns null when the token endpoint fails or returns a non-string token', async () => {
      installFetchResponses(
        jsonResponse({ error: 'unauthorized' }, { status: 401 }),
        jsonResponse({ accessToken: 123 })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(authClient.getToken()).resolves.toBeNull();
      await expect(authClient.getToken()).resolves.toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Auth token response failed validation', {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: 'accessToken',
          }),
        ]),
      });
    });

    it('returns null when the token endpoint returns a blank token', async () => {
      installFetchResponses(jsonResponse({ accessToken: '' }));
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(authClient.getToken()).resolves.toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Auth token response failed validation', {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: 'accessToken',
          }),
        ]),
      });
    });

    it('returns null when the token response JSON is malformed', async () => {
      installFetchResponses({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const token = await authClient.getToken();

      expect(token).toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Auth token response JSON parsing failed', {
        error: expect.any(SyntaxError),
      });
    });

    it('logs network token failures as debug and unexpected failures as warnings', async () => {
      const networkFetch = createFetchMock(async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      });
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        fetchImpl: networkFetch,
      });

      await expect(authClient.getToken()).resolves.toBeNull();
      expect(getAuthLogger().debug).toHaveBeenCalledWith('Token fetch bypassed (network/aborted)', {
        error: expect.objectContaining({ name: 'AbortError' }),
      });

      const unexpectedFetch = createFetchMock(async () => {
        throw new Error('token boom');
      });
      authClient.configure({
        baseUrl: 'https://auth.taskforceai.chat',
        fetchImpl: unexpectedFetch,
      });

      await expect(authClient.getToken()).resolves.toBeNull();
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Failed to fetch auth token', {
        error: expect.any(Error),
      });
    });
  });

  describe('signIn', () => {
    it('rejects unsupported providers before redirecting', async () => {
      setTestWindow('https://app.taskforceai.chat');

      await expect(authClient.signIn('password')).rejects.toThrow('Unsupported provider: password');
      expect(globalThis.window.location.href).toBe('https://app.taskforceai.chat');
    });

    it('redirects supported providers to a sanitized sign-in URL', async () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signIn('github', {
        callbackUrl: '/billing?inviteToken=secret&plan=super#fragment',
      });

      const redirected = new URL(globalThis.window.location.href);
      expect(redirected.origin).toBe('https://auth.taskforceai.chat');
      expect(redirected.pathname).toBe('/api/v1/auth/login');
      expect(redirected.searchParams.get('callbackUrl')).toBe('/billing?plan=super');
    });

    it('uses the current origin as the default browser callback', async () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signIn('google');

      const redirected = new URL(globalThis.window.location.href);
      expect(redirected.searchParams.get('callbackUrl')).toBe('https://app.taskforceai.chat/');
    });
  });

  describe('signOut', () => {
    it('sanitizes callback URL and prevents redirecting to untrusted server URL', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const fetchMock = installFetchResponses(
        jsonResponse({ csrfToken: 'csrf-token-1' }),
        jsonResponse({ url: 'https://attacker.example/logout' })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signOut({
        callbackUrl: 'https://attacker.example/callback',
        redirect: true,
      });

      const [, signOutInit] = fetchCalls(fetchMock)[1]!;
      const body = (signOutInit as RequestInit).body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const params = body as URLSearchParams;
      expect(params.get('callbackUrl')).toBe('/');
      expect(params.get('csrfToken')).toBe('csrf-token-1');

      const headers = new Headers((signOutInit as RequestInit).headers);
      expect(headers.get('X-CSRF-Token')).toBe('csrf-token-1');
      expect(globalThis.window.location.href).toBe('/');
    });

    it('falls back to safe callback URL when signout request fails', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const fetchMock = createFetchMock(async () => {
        throw new Error('Network failure');
      });
      globalThis.fetch = fetchMock;
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(
        authClient.signOut({
          callbackUrl: '/signed-out?session=secret#fragment',
          redirect: true,
        })
      ).rejects.toThrow('Network failure');

      expect(globalThis.window.location.href).toBe('/signed-out');
    });

    it('rejects protocol-relative callback URLs for signout redirects', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const fetchMock = installFetchResponses(
        jsonResponse({ csrfToken: 'csrf-token-3' }),
        jsonResponse({ url: '//attacker.example/logout' })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signOut({
        callbackUrl: '//attacker.example/callback',
        redirect: true,
      });

      const [, signOutInit] = fetchCalls(fetchMock)[1]!;
      const body = (signOutInit as RequestInit).body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const params = body as URLSearchParams;
      expect(params.get('callbackUrl')).toBe('/');
      expect(globalThis.window.location.href).toBe('/');
    });

    it('rejects malformed csrf payloads without submitting signout', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const fetchMock = installFetchResponses(
        jsonResponse({ csrfToken: 123 }),
        jsonResponse({ url: 'https://app.taskforceai.chat/signed-out' })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(
        authClient.signOut({
          callbackUrl: '/signed-out',
          redirect: true,
        })
      ).rejects.toThrow('Sign-out CSRF response was invalid');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(globalThis.window.location.href).toBe('/signed-out');
      expect(getAuthLogger().warn).toHaveBeenCalledWith(
        'Sign-out CSRF response failed validation',
        {
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'csrfToken',
            }),
          ]),
        }
      );
    });

    it('rejects missing csrf tokens without submitting signout', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const fetchMock = installFetchResponses(
        {
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        } as unknown as Response,
        jsonResponse({ url: 'https://app.taskforceai.chat/signed-out' })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(
        authClient.signOut({
          callbackUrl: '/signed-out',
          redirect: true,
        })
      ).rejects.toThrow('Sign-out CSRF token was missing');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(globalThis.window.location.href).toBe('/signed-out');
      expect(getAuthLogger().warn).toHaveBeenCalledWith(
        'Sign-out CSRF response JSON parsing failed',
        {
          error: expect.any(SyntaxError),
        }
      );
    });

    it('rejects unsuccessful csrf and signout responses', async () => {
      setTestWindow('https://app.taskforceai.chat');
      const csrfFailure = installFetchResponses(
        jsonResponse({ error: 'unavailable' }, { status: 503 })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(authClient.signOut({ redirect: false })).rejects.toThrow(
        'Sign-out CSRF request failed with status 503'
      );
      expect(csrfFailure).toHaveBeenCalledTimes(1);

      const signOutFailure = installFetchResponses(
        jsonResponse({ csrfToken: 'csrf-token' }),
        jsonResponse({ error: 'forbidden' }, { status: 403 })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await expect(authClient.signOut({ redirect: false })).rejects.toThrow(
        'Sign-out request failed with status 403'
      );
      expect(signOutFailure).toHaveBeenCalledTimes(2);
    });

    it('falls back to the safe callback when signout response is malformed', async () => {
      setTestWindow('https://app.taskforceai.chat');
      installFetchResponses(
        jsonResponse({ csrfToken: 'csrf-token-4' }),
        jsonResponse('not-an-object')
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signOut({
        callbackUrl: '/signed-out?token=secret#fragment',
        redirect: true,
      });

      expect(globalThis.window.location.href).toBe('/signed-out');
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Sign-out response failed validation', {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '',
          }),
        ]),
      });
    });

    it('falls back to the safe callback when signout response JSON is malformed', async () => {
      setTestWindow('https://app.taskforceai.chat');
      installFetchResponses(jsonResponse({ csrfToken: 'csrf-token-5' }), {
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response);
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signOut({
        callbackUrl: '/signed-out?token=secret#fragment',
        redirect: true,
      });

      expect(globalThis.window.location.href).toBe('/signed-out');
      expect(getAuthLogger().warn).toHaveBeenCalledWith('Sign-out response JSON parsing failed', {
        error: expect.any(SyntaxError),
      });
    });

    it('skips client redirect when redirect is false', async () => {
      setTestWindow('https://app.taskforceai.chat');
      installFetchResponses(
        jsonResponse({ csrfToken: 'csrf-token-2' }),
        jsonResponse({ url: 'https://app.taskforceai.chat/after-signout' })
      );
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      await authClient.signOut({
        callbackUrl: '/after-signout',
        redirect: false,
      });

      expect(globalThis.window.location.href).toBe('https://app.taskforceai.chat');
    });
  });
});
