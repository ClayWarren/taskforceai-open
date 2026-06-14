import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { authClient } from './auth-client';

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
    authClient.configure({
      baseUrl: undefined,
      getTokenProvider: undefined,
      fetchImpl: undefined,
    });
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
    vi.clearAllMocks();
  });

  describe('getSignInUrl', () => {
    it('normalizes configured base URL without duplicate slashes', () => {
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat/' });

      const signInUrl = authClient.getSignInUrl();

      expect(signInUrl).toContain('https://auth.taskforceai.chat/api/v1/auth/login');
      expect(signInUrl).not.toContain('//api/v1/auth/login');
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

    it('rejects protocol-relative callback URLs', () => {
      setTestWindow('https://app.taskforceai.chat');
      authClient.configure({ baseUrl: 'https://auth.taskforceai.chat' });

      const signInUrl = authClient.getSignInUrl({
        callbackUrl: '//attacker.example/callback',
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
      const [, init] = fetchCalls(fetchMock)[0]!;
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('Authorization')).toBe('Bearer provider-token');
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
  });

  describe('getToken', () => {
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

      await authClient.signOut({
        callbackUrl: '/signed-out?session=secret#fragment',
        redirect: true,
      });

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
