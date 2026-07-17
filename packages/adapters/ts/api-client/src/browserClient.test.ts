import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';

// @unit-no-dom: this file verifies the real browser client module and installs its own
// minimal browser globals, so it must not load the frontend-wide DOM mocks.
import { deleteAccount } from './api/gdpr';
import { authClient } from './auth/auth-client';
import { clearBrowserClientCache, getBrowserClient, setBrowserClient } from './browserClient';

void vi.mock('../../../../qa/observability', () => ({
  metrics: {
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
    recordHistogram: vi.fn(),
    startTimer: () => () => {},
  },
  resetMetrics: vi.fn(),
  trackRenderCount: vi.fn(),
  recordQueryLatency: vi.fn(),
  recordCacheDivergence: vi.fn(),
}));

const emptyConversationResponse = {
  conversations: [],
  total: 0,
  limit: 20,
  offset: 0,
  has_more: false,
};

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(vi.fn(impl), { preconnect: vi.fn() });

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNextPublicApiUrl =
  typeof process !== 'undefined' && process.env ? process.env['NEXT_PUBLIC_API_URL'] : undefined;
const originalNextPublicAuthUrl =
  typeof process !== 'undefined' && process.env ? process.env['NEXT_PUBLIC_AUTH_URL'] : undefined;

const setTestWindow = (hostname: string) => {
  const origin = `https://${hostname}`;
  // @ts-expect-error - test environment sets a minimal window shape
  globalThis.window = { location: { hostname, origin, href: origin } };
};

beforeEach(() => {
  setBrowserClient(null);
  clearBrowserClientCache();
  if (typeof process !== 'undefined' && process.env) {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.taskforceai.chat';
  }
});

afterEach(() => {
  clearBrowserClientCache();
  setBrowserClient(null);
  globalThis.fetch = originalFetch;

  if (typeof originalWindow === 'undefined') {
    // @ts-expect-error - deleting test-injected window
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }

  if (typeof originalDocument === 'undefined') {
    // @ts-expect-error - deleting test-injected document
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }

  if (typeof process !== 'undefined' && process.env) {
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
  }

  vi.clearAllMocks();
});

describe('getBrowserClient', () => {
  it('resets cached client with setBrowserClient', () => {
    clearBrowserClientCache();
    const first = getBrowserClient();
    setBrowserClient(null);
    const second = getBrowserClient();

    expect(second).not.toBe(first);
  });

  it('clears browser client cache', () => {
    clearBrowserClientCache();
    const first = getBrowserClient();
    clearBrowserClientCache();
    const second = getBrowserClient();

    expect(second).not.toBe(first);
  });

  it('reuses cached client', () => {
    clearBrowserClientCache();
    const first = getBrowserClient();
    const second = getBrowserClient();

    expect(second).toBe(first);
  });

  it('recreates client when getToken function changes', () => {
    const first = getBrowserClient({
      getToken: () => ({ ok: true, value: 'token-a' }),
    });
    const second = getBrowserClient({
      getToken: () => ({ ok: true, value: 'token-b' }),
    });

    expect(second).not.toBe(first);
  });

  it('recreates client when baseUrl changes', () => {
    const first = getBrowserClient({ baseUrl: 'https://api-one.taskforceai.chat' });
    const second = getBrowserClient({ baseUrl: 'https://api-two.taskforceai.chat' });

    expect(second).not.toBe(first);
  });

  it('prefers manually injected clients regardless of options', () => {
    clearBrowserClientCache();
    const injected = { marker: 'manual' } as unknown as ReturnType<typeof getBrowserClient>;
    setBrowserClient(injected);

    const resolved = getBrowserClient({
      baseUrl: 'https://api-override.taskforceai.chat',
      getToken: () => ({ ok: true, value: 'override-token' }),
    });

    expect(resolved).toBe(injected);
  });

  it('uses Tauri base URL when running in Tauri desktop app', async () => {
    // @ts-expect-error - simulating Tauri environment
    globalThis.window = { __TAURI__: {} };

    clearBrowserClientCache();
    setBrowserClient(null);

    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify(emptyConversationResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const client = getBrowserClient();
    await client.getConversations();

    const mockCalls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const call = mockCalls[0];
    if (!call) {
      expect(
        (client.getConversations as unknown as { mock?: { calls: unknown[][] } }).mock?.calls.length
      ).toBe(1);
      return;
    }
    const [url] = call;
    expect(url).toContain('https://taskforceai.chat');
  });

  it('reads a browser-global API URL when process env is unavailable', () => {
    const originalProcess = globalThis.process;
    try {
      clearBrowserClientCache();
      delete (globalThis as { process?: typeof process }).process;
      (globalThis as { window: Window & typeof globalThis }).window = {
        location: { hostname: 'app.taskforceai.test', origin: 'https://app.taskforceai.test' },
        NEXT_PUBLIC_API_URL: 'https://browser-env.taskforceai.test',
      } as unknown as Window & typeof globalThis;

      expect(() => getBrowserClient()).not.toThrow();
    } finally {
      globalThis.process = originalProcess;
    }
  });

  it('throws on server-side when NEXT_PUBLIC_API_URL is relative', () => {
    // @ts-expect-error - simulate server runtime
    delete globalThis.window;
    if (typeof process !== 'undefined' && process.env) {
      process.env['NEXT_PUBLIC_API_URL'] = '/api';
    }

    expect(() => getBrowserClient()).toThrow(
      'NEXT_PUBLIC_API_URL must be set to an absolute http(s) URL for server-side API calls'
    );
  });

  it('adds CSRF headers to finance link-token requests by default', async () => {
    Object.defineProperty(globalThis, 'document', {
      value: {
        cookie: 'csrf_token=csrf-token',
      },
      configurable: true,
      writable: true,
    });

    const fetchMock = createFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            link_token: 'link-production',
            expiration: '2026-06-06T23:59:00Z',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    globalThis.fetch = fetchMock;

    const client = getBrowserClient({
      getToken: () => ({ ok: true, value: 'auth-token' }),
    });
    await client.createFinanceLinkToken();

    const mockCalls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const firstCall = mockCalls[0];
    if (!firstCall) throw new Error('No fetch call');
    const [, init] = firstCall;
    if (!init || typeof init !== 'object') throw new Error('No fetch init');

    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
  });
});

describe('gdpr deleteAccount payload', () => {
  it('sends confirmEmail in request body', async () => {
    Object.defineProperty(globalThis, 'document', {
      value: {
        cookie: 'csrf_token=csrf-token',
      },
      configurable: true,
      writable: true,
    });

    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ message: 'deleted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    await deleteAccount('demo-user');

    const mockCalls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const firstCall = mockCalls[0];
    if (!firstCall) throw new Error('No fetch call');
    const [, init] = firstCall;
    if (!init || typeof init !== 'object') throw new Error('No fetch init');

    const requestInit = init as RequestInit;
    expect(requestInit.body).toBe(JSON.stringify({ confirmEmail: 'demo-user' }));
  });
});

describe('authClient hostname validation', () => {
  it('rejects spoofed taskforce hostnames for auth fallback', async () => {
    if (typeof process !== 'undefined' && process.env) {
      delete process.env['NEXT_PUBLIC_AUTH_URL'];
    }

    setTestWindow('taskforceai.chat.attacker.example');
    await authClient.signIn('google');

    const hrefSchema = z
      .string()
      .startsWith('/api/v1/auth/login?callbackUrl=')
      .refine((href) => !href.includes('https://auth.taskforceai.chat'));
    hrefSchema.parse(globalThis.window.location.href);
  });

  it('accepts valid taskforce hostnames for auth fallback', async () => {
    if (typeof process !== 'undefined' && process.env) {
      delete process.env['NEXT_PUBLIC_AUTH_URL'];
    }

    setTestWindow('app.taskforceai.chat');
    await authClient.signIn('google');

    // For trusted hostnames, use the canonical auth host for top-level sign-in redirects.
    const hrefSchema = z
      .string()
      .startsWith('https://auth.taskforceai.chat/api/v1/auth/login?callbackUrl=');
    hrefSchema.parse(globalThis.window.location.href);
  });

  it('uses relative path for trusted hostnames in internal auth calls (Hardening TF-0188)', async () => {
    setTestWindow('app.taskforceai.chat');

    const fetchMock = createFetchMock(
      async () => new Response(JSON.stringify({}), { status: 200 })
    );
    globalThis.fetch = fetchMock;

    await authClient.getToken();

    const mockCalls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const [url] = mockCalls[0]!;
    // Should be relative path starting with /api/v1
    expect(url as string).toBe('/api/v1/auth/token');
  });
});
