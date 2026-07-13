import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const createGatewayMock = vi.fn();
const getTokenMock = vi.fn();
const getApiRequestAuthSnapshotMock = vi.fn();
const validateApiRequestCsrfMock = vi.fn();
const voiceRequestLimits = new Map<string, { count: number; resetAt: number }>();
let capturedRouteConfig: any;

vi.mock('@tanstack/react-start', () => ({}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (config: any) => {
    capturedRouteConfig = config;
    return config;
  }),
}));

vi.mock('@ai-sdk/gateway', () => ({
  createGateway: createGatewayMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../-voice-gateway', () => ({
  recordCompletedVoiceUsage: async () => true,
  consumeVoiceRequestLimit: (scope: string, _request: Request, now = Date.now()) => {
    const options = { maxRequests: scope === 'realtime-setup' ? 6 : 12, windowMs: 60_000 };
    const key = scope;
    const current = voiceRequestLimits.get(key);
    if (!current || current.resetAt <= now) {
      const resetAt = now + options.windowMs;
      voiceRequestLimits.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        limit: options.maxRequests,
        remaining: options.maxRequests - 1,
        resetAt,
        retryAfterSeconds: 0,
      };
    }
    if (current.count >= options.maxRequests) {
      return {
        allowed: false,
        limit: options.maxRequests,
        remaining: 0,
        resetAt: current.resetAt,
        retryAfterSeconds: 1,
      };
    }
    current.count += 1;
    return {
      allowed: true,
      limit: options.maxRequests,
      remaining: options.maxRequests - current.count,
      resetAt: current.resetAt,
      retryAfterSeconds: 0,
    };
  },
  createVoiceRateLimitResponse: (
    error: string,
    limit: { retryAfterSeconds: number; limit: number; resetAt: number }
  ) =>
    Response.json(
      { error },
      {
        status: 429,
        headers: {
          'cache-control': 'private, no-store',
          'retry-after': String(limit.retryAfterSeconds),
          'x-ratelimit-limit': String(limit.limit),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1_000)),
        },
      }
    ),
  getApiRequestAuthSnapshot: getApiRequestAuthSnapshotMock,
  getGatewayApiKey: () => process.env['AI_GATEWAY_API_KEY']?.trim() || null,
  getGatewayErrorSummary: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
  getGatewayStatusCode: () => 502,
  resetVoiceRequestLimitsForTests: () => {
    voiceRequestLimits.clear();
  },
  validateApiRequestCsrf: validateApiRequestCsrfMock,
  voiceRateLimitHeaders: (limit: { limit: number; remaining: number; resetAt: number }) => ({
    'x-ratelimit-limit': String(limit.limit),
    'x-ratelimit-remaining': String(limit.remaining),
    'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1_000)),
  }),
}));

await import('./setup');

const originalGatewayApiKey = process.env['AI_GATEWAY_API_KEY'];

const makeRealtimeSetupRequest = () =>
  new Request('https://taskforceai.example/api/realtime/setup', {
    method: 'POST',
    headers: {
      'x-real-ip': '203.0.113.44',
    },
  });

describe('realtime voice setup route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceRequestLimits.clear();
    process.env['AI_GATEWAY_API_KEY'] = 'gateway-key';
    validateApiRequestCsrfMock.mockReturnValue(null);
    getApiRequestAuthSnapshotMock.mockResolvedValue({
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: {
        id: 12,
        email: 'voice@example.com',
        plan: 'free',
      },
    });
    getTokenMock.mockResolvedValue({ token: 'realtime-token' });
    createGatewayMock.mockReturnValue({
      experimental_realtime: {
        getToken: getTokenMock,
      },
    });
  });

  afterEach(() => {
    if (originalGatewayApiKey === undefined) {
      Reflect.deleteProperty(process.env, 'AI_GATEWAY_API_KEY');
      return;
    }
    process.env['AI_GATEWAY_API_KEY'] = originalGatewayApiKey;
  });

  it('mints a realtime token with bounded rate-limit headers', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeRealtimeSetupRequest(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'realtime-token', tools: [] });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-ratelimit-limit')).toBe('6');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('5');
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'gateway-key' });
    expect(getTokenMock).toHaveBeenCalledWith({
      model: 'xai/grok-voice-think-fast-1.0',
      expiresAfterSeconds: 60,
    });
  });

  it('rate limits repeated authenticated token minting before calling the Gateway', async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await capturedRouteConfig.server.handlers.POST({
        request: makeRealtimeSetupRequest(),
      });
      expect(response.status).toBe(200);
    }

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeRealtimeSetupRequest(),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Realtime voice setup rate limit exceeded',
    });
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(response.headers.get('x-ratelimit-limit')).toBe('6');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(getTokenMock).toHaveBeenCalledTimes(6);
  });

  it('requires authentication before minting a realtime token', async () => {
    getApiRequestAuthSnapshotMock.mockResolvedValueOnce({
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
      user: null,
    });

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeRealtimeSetupRequest(),
    });

    expect(response.status).toBe(401);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('rejects session-cookie requests that fail csrf validation before minting a token', async () => {
    validateApiRequestCsrfMock.mockReturnValueOnce(
      Response.json({ error: 'CSRF token missing' }, { status: 403 })
    );

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeRealtimeSetupRequest(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CSRF token missing' });
    expect(getTokenMock).not.toHaveBeenCalled();
  });
});
