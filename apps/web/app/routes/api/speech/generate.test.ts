import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { MAX_SPEECH_TEXT_CHARS } from '@taskforceai/client-runtime';

const createGatewayMock = vi.fn();
const generateSpeechMock = vi.fn();
const getApiRequestAuthSnapshotMock = vi.fn();
const validateApiRequestCsrfMock = vi.fn();
const consumeVoiceRequestLimitMock = vi.fn();
const speechModel = { modelId: 'xai/grok-tts' };
const speechMock = vi.fn(() => speechModel);
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

vi.mock('ai', () => ({
  generateSpeech: generateSpeechMock,
  transcribe: vi.fn(),
}));

vi.mock('../../../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../-voice-gateway', () => ({
  consumeVoiceRequestLimit: consumeVoiceRequestLimitMock,
  createVoiceRateLimitResponse: (error: string) => Response.json({ error }, { status: 429 }),
  getApiRequestAuthSnapshot: getApiRequestAuthSnapshotMock,
  getGatewayApiKey: () => process.env['AI_GATEWAY_API_KEY']?.trim() || null,
  getGatewayErrorSummary: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
  getGatewayStatusCode: () => 502,
  recordCompletedVoiceUsage: async () => true,
  validateApiRequestCsrf: validateApiRequestCsrfMock,
  voiceRateLimitHeaders: () => ({}),
}));

await import('./generate');

const originalGatewayApiKey = process.env['AI_GATEWAY_API_KEY'];

const makeSpeechRequest = (body: unknown = { text: 'Read this response aloud.' }) =>
  new Request('https://taskforceai.example/api/speech/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('speech generation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AI_GATEWAY_API_KEY'] = 'gateway-key';
    getApiRequestAuthSnapshotMock.mockResolvedValue({
      isAuthenticated: true,
      sessionStatus: 'authenticated',
      user: {
        id: 12,
        email: 'voice@example.com',
      },
    });
    validateApiRequestCsrfMock.mockReturnValue(null);
    consumeVoiceRequestLimitMock.mockReturnValue({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    });
    createGatewayMock.mockReturnValue({
      speech: speechMock,
    });
    generateSpeechMock.mockResolvedValue({
      audio: {
        format: 'mp3',
        mediaType: 'audio/mpeg',
        uint8Array: new Uint8Array([1, 2, 3]),
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

  it('generates speech audio with xai/grok-tts', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-taskforceai-audio-format')).toBe('mp3');
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'gateway-key' });
    expect(speechMock).toHaveBeenCalledWith('xai/grok-tts');
    expect(generateSpeechMock).toHaveBeenCalledWith({
      model: speechModel,
      text: 'Read this response aloud.',
      outputFormat: 'mp3',
      maxRetries: 1,
    });
  });

  it('requires authentication before generating speech', async () => {
    getApiRequestAuthSnapshotMock.mockResolvedValueOnce({
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
      user: null,
    });

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest(),
    });

    expect(response.status).toBe(401);
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });

  it('rejects csrf failures before generating speech', async () => {
    validateApiRequestCsrfMock.mockReturnValueOnce(
      Response.json({ error: 'CSRF token missing' }, { status: 403 })
    );

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CSRF token missing' });
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });

  it('rate limits authenticated speech generation before calling the model', async () => {
    consumeVoiceRequestLimitMock.mockReturnValueOnce({
      allowed: false,
      limit: 12,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    });

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest(),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Speech generation rate limit exceeded',
    });
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });

  it('validates speech request text', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest({ text: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Text is required' });
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });

  it('rejects speech text above the bounded generation limit', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest({ text: 'a'.repeat(MAX_SPEECH_TEXT_CHARS + 1) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Text is too long for speech generation' });
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });

  it('reports missing Gateway configuration without calling the model', async () => {
    Reflect.deleteProperty(process.env, 'AI_GATEWAY_API_KEY');

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeSpeechRequest(),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Speech generation is not configured for this deployment',
    });
    expect(generateSpeechMock).not.toHaveBeenCalled();
  });
});
