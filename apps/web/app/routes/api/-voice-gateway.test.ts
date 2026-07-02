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
    voiceGateway.resetVoiceRequestLimitsForTests();
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

  it('rate limits by voice feature and authenticated actor', () => {
    const request = new Request('https://www.taskforceai.chat/api/speech/generate', {
      headers: { 'x-real-ip': '203.0.113.9' },
    });
    const auth = {
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: { id: 7, email: 'voice@example.com' },
    } as Parameters<typeof voiceGateway.consumeVoiceRequestLimit>[2];
    const options = { maxRequests: 2, windowMs: 60_000 };

    expect(
      voiceGateway.consumeVoiceRequestLimit('speech', request, auth, options, 1_000)
    ).toMatchObject({ allowed: true, remaining: 1 });
    expect(
      voiceGateway.consumeVoiceRequestLimit('speech', request, auth, options, 1_001)
    ).toMatchObject({ allowed: true, remaining: 0 });
    expect(
      voiceGateway.consumeVoiceRequestLimit('speech', request, auth, options, 1_002)
    ).toMatchObject({ allowed: false, remaining: 0 });
    expect(
      voiceGateway.consumeVoiceRequestLimit('dictation', request, auth, options, 1_003)
    ).toMatchObject({ allowed: true, remaining: 1 });
  });
});
