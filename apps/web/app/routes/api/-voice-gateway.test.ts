import { beforeEach, describe, expect, it, vi } from 'bun:test';

const loadRootBootstrapSnapshotMock = vi.fn();
let capturedContext: unknown;

vi.mock('../../lib/bootstrap/app-shell-bootstrap-snapshots', () => ({
  loadRootBootstrapSnapshot: loadRootBootstrapSnapshotMock,
}));

const voiceGateway = await import('./-voice-gateway');

const withServerHeader = (request: Request, name: string, value: string): Request => {
  const originalGet = request.headers.get.bind(request.headers);
  Object.defineProperty(request.headers, 'get', {
    configurable: true,
    value: (headerName: string) =>
      headerName.toLowerCase() === name.toLowerCase() ? value : originalGet(headerName),
  });
  return request;
};

describe('voice gateway auth helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedContext = null;
    loadRootBootstrapSnapshotMock.mockImplementation(async (context: unknown) => {
      capturedContext = context;
      return {
        auth: {
          isAuthenticated: true,
          sessionStatus: 'authenticated',
          user: { id: 7, email: 'voice@example.com' },
        },
      };
    });
  });

  it('uses an API-sized auth timeout and forwards request credentials', async () => {
    const request = withServerHeader(
      new Request('https://www.taskforceai.chat/api/realtime/setup', {
        headers: {
          authorization: 'Bearer session-token',
        },
      }),
      'cookie',
      'session_token=session-token; csrf_token=csrf'
    );

    const auth = await voiceGateway.getApiRequestAuthSnapshot(request);

    expect(auth).toMatchObject({ isAuthenticated: true });
    expect(capturedContext).toMatchObject({
      authorization: 'Bearer session-token',
      authTimeoutMs: voiceGateway.VOICE_API_AUTH_TIMEOUT_MS,
      cookie: 'session_token=session-token; csrf_token=csrf',
      origin: 'https://taskforceai.chat',
    });
  });

  it('requires matching csrf header and cookie for session-cookie requests', async () => {
    const validRequest = withServerHeader(
      new Request('https://www.taskforceai.chat/api/speech/generate', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'csrf',
        },
      }),
      'cookie',
      'session_token=session-token; csrf_token=csrf'
    );

    expect(voiceGateway.validateApiRequestCsrf(validRequest)).toBeNull();

    const missingHeader = withServerHeader(
      new Request('https://www.taskforceai.chat/api/speech/generate', {
        method: 'POST',
      }),
      'cookie',
      'session_token=session-token; csrf_token=csrf'
    );
    const missingHeaderResponse = voiceGateway.validateApiRequestCsrf(missingHeader);
    expect(missingHeaderResponse?.status).toBe(403);
    expect(await missingHeaderResponse?.json()).toEqual({ error: 'CSRF token missing' });

    const mismatch = withServerHeader(
      new Request('https://www.taskforceai.chat/api/speech/generate', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'other',
        },
      }),
      'cookie',
      'session_token=session-token; csrf_token=csrf'
    );
    const mismatchResponse = voiceGateway.validateApiRequestCsrf(mismatch);
    expect(mismatchResponse?.status).toBe(403);
    expect(await mismatchResponse?.json()).toEqual({ error: 'CSRF token mismatch' });
  });

  it('exempts bearer-only API requests from csrf validation', () => {
    const request = new Request('https://www.taskforceai.chat/api/realtime/setup', {
      method: 'POST',
      headers: {
        authorization: 'Bearer session-token',
      },
    });

    expect(voiceGateway.validateApiRequestCsrf(request)).toBeNull();
  });

  it('reserves voice capacity through the authenticated Go authority', async () => {
    const request = withServerHeader(
      new Request('https://www.taskforceai.chat/api/speech/generate', {
        headers: {
          authorization: 'Bearer session-token',
          'x-csrf-token': 'csrf',
          'x-real-ip': '203.0.113.9',
          'x-forwarded-for': '198.51.100.8',
        },
      }),
      'cookie',
      'session_token=session-token; csrf_token=csrf'
    );
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        allowed: true,
        limit: 12,
        remaining: 11,
        resetAt: 61_000,
        retryAfterSeconds: 0,
      })
    );

    const result = await voiceGateway.consumeVoiceRequestLimit(
      'speech',
      request,
      fetchMock as unknown as typeof fetch
    );

    expect(result).toEqual({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetAt: 61_000,
      retryAfterSeconds: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [undefined, undefined];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('https://taskforceai.chat/api/v1/voice/reserve');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ operation: 'speech' }));
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer session-token');
    expect(headers.get('cookie')).toBe('session_token=session-token; csrf_token=csrf');
    expect(headers.get('x-csrf-token')).toBe('csrf');
    expect(headers.has('x-real-ip')).toBeFalse();
    expect(headers.has('x-forwarded-for')).toBeFalse();
  });

  it('fails closed when the Go voice authority is unavailable', async () => {
    const request = new Request('https://www.taskforceai.chat/api/speech/generate', {
      headers: { authorization: 'Bearer session-token' },
    });
    const result = await voiceGateway.consumeVoiceRequestLimit(
      'speech',
      request,
      vi.fn(async () =>
        Response.json({ error: 'unavailable' }, { status: 503 })
      ) as unknown as typeof fetch
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
  });
});
