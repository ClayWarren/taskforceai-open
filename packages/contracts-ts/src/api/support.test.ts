import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

mock.module('@taskforceai/contracts/auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

mock.module('../auth/logger', () => ({
  getAuthLogger: () => logger,
}));

const { reportIssue } = (await import(
  `./support?test=${Date.now()}`
)) as typeof import('./support');

const createFetchMock = (
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => Object.assign(vi.fn(impl), { preconnect: vi.fn() });

const readFetchCalls = (fetchMock: typeof fetch): unknown[][] =>
  (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;

describe('support api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits support reports with csrf and metadata', async () => {
    const fetchMock = createFetchMock(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;

    await reportIssue({
      category: 'ui_bug',
      description: 'Broken button',
      metadata: { conversationId: 'conv_123' },
    });

    const [url, init] = readFetchCalls(fetchMock)[0] ?? [];
    expect(url).toBe('/api/v1/support/report');
    const requestInit = init as RequestInit;
    expect(requestInit.method).toBe('POST');
    expect(requestInit.credentials).toBe('include');
    expect(new Headers(requestInit.headers).get('X-CSRF-Token')).toBe('csrf-token');
    expect(requestInit.body).toBe(
      JSON.stringify({
        category: 'ui_bug',
        description: 'Broken button',
        metadata: { conversationId: 'conv_123' },
      })
    );
    expect(logger.info).toHaveBeenCalledWith('Support issue report submitted');
  });

  it('omits null metadata from the request body', async () => {
    const fetchMock = createFetchMock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;

    await reportIssue({ category: 'billing', description: 'Need help', metadata: null });

    const [, init] = readFetchCalls(fetchMock)[0] ?? [];
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        category: 'billing',
        description: 'Need help',
      })
    );
  });

  it('throws backend error messages when submission fails', async () => {
    globalThis.fetch = createFetchMock(
      async () =>
        new Response(JSON.stringify({ error: 'Report rejected' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(reportIssue({ category: 'ui_bug', description: 'Broken button' })).rejects.toThrow(
      'Report rejected'
    );
  });

  it('falls back to a generic error when failure payload is not parseable', async () => {
    globalThis.fetch = createFetchMock(async () => new Response('not-json', { status: 500 }));

    await expect(reportIssue({ category: 'ui_bug', description: 'Broken' })).rejects.toThrow(
      'Unable to submit report'
    );
    expect(logger.warn).toHaveBeenCalledWith('Failed to parse support report error response', {
      error: expect.any(Error),
      status: 500,
    });
  });
});
