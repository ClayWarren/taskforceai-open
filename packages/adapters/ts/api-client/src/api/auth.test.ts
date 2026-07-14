import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

mock.module('../auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

const { authorizeDeviceCode } = (await import(
  `./auth?test=${Date.now()}`
)) as typeof import('./auth');
const { getCsrfToken } = await import('../auth/csrf');

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(vi.fn(impl), { preconnect: vi.fn() });

describe('authorizeDeviceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds csrf token header to device authorize requests', async () => {
    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await authorizeDeviceCode('ABCD-1234');
    expect(result.status).toBe('success');

    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const firstCall = calls[0];
    if (!firstCall) {
      throw new Error('Expected fetch call');
    }
    const [, init] = firstCall;
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  it('returns unauthorized result when backend rejects session', async () => {
    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await authorizeDeviceCode('ABCD-1234');
    expect(result).toEqual({ status: 'unauthorized' });
    expect(getCsrfToken).toHaveBeenCalled();
  });

  it.each([
    [410, { status: 'expired' }],
    [404, { status: 'not_found' }],
  ] as const)('maps %d responses to device status', async (statusCode, expected) => {
    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ error: 'Nope' }), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await authorizeDeviceCode('ABCD-1234');

    expect(result).toEqual(expected);
  });

  it('returns backend error messages for unexpected responses', async () => {
    const fetchMock = createFetchMock(
      async () =>
        new Response(JSON.stringify({ error: 'Device code is invalid' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await authorizeDeviceCode('ABCD-1234');

    expect(result).toEqual({ status: 'error', message: 'Device code is invalid' });
  });

  it('falls back when unexpected response payload is not parseable', async () => {
    const fetchMock = createFetchMock(
      async () =>
        new Response('{', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    globalThis.fetch = fetchMock;

    const result = await authorizeDeviceCode('ABCD-1234');

    expect(result).toEqual({ status: 'error', message: 'Unexpected error' });
  });

  it('returns a generic error when fetch throws', async () => {
    globalThis.fetch = createFetchMock(async () => {
      throw new Error('offline');
    });

    const result = await authorizeDeviceCode('ABCD-1234');

    expect(result).toEqual({
      status: 'error',
      message: 'Something went wrong. Please try again.',
    });
  });
});
