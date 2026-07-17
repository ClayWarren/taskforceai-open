import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../../../tests/setup/dom';

import { REALTIME_SETUP_ENDPOINT } from '@taskforceai/client-runtime';

const getCsrfTokenMock = vi.fn();
const getStoredTokenMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock('@taskforceai/api-client/auth/auth-storage', () => ({
  getStoredToken: getStoredTokenMock,
}));

vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken: getCsrfTokenMock,
}));

vi.mock('../../../../lib/logger', () => ({
  logger: {
    debug: loggerDebugMock,
  },
}));

type FetchTestMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
> &
  Omit<typeof fetch, 'preconnect'> & {
    preconnect: ReturnType<typeof vi.fn<typeof globalThis.fetch.preconnect>>;
  };

const createFetchMock = (): FetchTestMock => {
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => Response.json({})
  );
  return Object.assign(mock, {
    preconnect: vi.fn<typeof globalThis.fetch.preconnect>(),
  }) as FetchTestMock;
};

const flushAsyncWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const loadModule = async () => import('../../../../lib/api/realtime-voice');

describe.serial('realtimeSetupFetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    getCsrfTokenMock.mockResolvedValue('csrf-token');
    getStoredTokenMock.mockReturnValue({ ok: true, value: 'browser-token' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('classifies realtime setup URL shapes while leaving malformed inputs untouched', async () => {
    const fetchMock = createFetchMock();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf } = await loadModule();

    await connectRealtimeWithCsrf(async () => {
      globalThis.fetch.preconnect?.(REALTIME_SETUP_ENDPOINT);
      await fetch(new URL(REALTIME_SETUP_ENDPOINT, window.location.origin));
      await fetch('http://[');
      await fetch({ url: 'http://[' } as Request);
    });

    expect(fetchMock.preconnect).toHaveBeenCalledWith(REALTIME_SETUP_ENDPOINT);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const realtimeHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(realtimeHeaders.get('X-CSRF-Token')).toBe('csrf-token');
    expect(realtimeHeaders.get('authorization')).toBe('Bearer browser-token');

    const malformedStringHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    const malformedRequestHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(malformedStringHeaders.get('X-CSRF-Token')).toBeNull();
    expect(malformedStringHeaders.get('authorization')).toBeNull();
    expect(malformedRequestHeaders.get('X-CSRF-Token')).toBeNull();
    expect(malformedRequestHeaders.get('authorization')).toBeNull();
  });

  it('falls back to live setup fetches when no prewarmed payload is available', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValueOnce(Response.json({ token: 'live-token' }));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { connectRealtimeWithCsrf, getRealtimeSetupRequestBody } = await loadModule();
    const sessionConfig = { outputModalities: ['audio' as const] };
    const setupBody = getRealtimeSetupRequestBody(sessionConfig);
    let payload: unknown = null;

    await connectRealtimeWithCsrf(
      async () => {
        const response = await fetch(REALTIME_SETUP_ENDPOINT, {
          method: 'POST',
          body: setupBody,
        });
        payload = await response.json();
      },
      { setupBody }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload).toEqual({ token: 'live-token' });
  });

  it('logs prewarm failures without blocking later setup attempts', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { prewarmRealtimeVoiceSetup } = await loadModule();

    prewarmRealtimeVoiceSetup({ outputModalities: ['audio' as const] });
    await flushAsyncWork();

    expect(loggerDebugMock).toHaveBeenCalledWith('Realtime voice setup prewarm failed', {
      error: expect.any(Error),
    });
  });

  it('logs warmup preconnect and csrf failures without throwing', async () => {
    const preconnectError = new Error('preconnect unavailable');
    const csrfError = new Error('csrf unavailable');
    const fetchMock = createFetchMock();
    fetchMock.preconnect.mockImplementationOnce(() => {
      throw preconnectError;
    });
    getCsrfTokenMock.mockRejectedValueOnce(csrfError);
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    const { warmRealtimeVoiceSetup } = await loadModule();

    warmRealtimeVoiceSetup();
    await flushAsyncWork();

    expect(loggerDebugMock).toHaveBeenCalledWith('Realtime voice preconnect failed', {
      error: preconnectError,
    });
    expect(loggerDebugMock).toHaveBeenCalledWith('Realtime voice CSRF prewarm failed', {
      error: csrfError,
    });
  });
});
