import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const createGatewayMock = vi.fn();
const getApiRequestAuthSnapshotMock = vi.fn();
const validateApiRequestCsrfMock = vi.fn();
const consumeVoiceRequestLimitMock = vi.fn();
const transcribeMock = vi.fn();
const transcriptionDoGenerateMock = vi.fn();
const transcriptionModel = {
  doGenerate: transcriptionDoGenerateMock,
  modelId: 'xai/grok-stt',
  provider: 'gateway',
  specificationVersion: 'v4',
};
const transcriptionMock = vi.fn(() => transcriptionModel);
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
  generateSpeech: vi.fn(),
  transcribe: transcribeMock,
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

await import('./transcribe');

const originalGatewayApiKey = process.env['AI_GATEWAY_API_KEY'];

const withServerHeader = (request: Request, name: string, value: string): Request => {
  const originalGet = request.headers.get.bind(request.headers);
  Object.defineProperty(request.headers, 'get', {
    configurable: true,
    value: (headerName: string) =>
      headerName.toLowerCase() === name.toLowerCase() ? value : originalGet(headerName),
  });
  return request;
};

const makeAudioRequest = (
  options: {
    contentLength?: string;
    name?: string;
    type?: string;
  } = {}
) => {
  const formData = new FormData();
  formData.set(
    'audio',
    new File(['audio'], options.name ?? 'dictation.webm', { type: options.type ?? 'audio/webm' })
  );
  const request = new Request('https://taskforceai.example/api/dictation/transcribe', {
    method: 'POST',
    body: formData,
  });
  return options.contentLength
    ? withServerHeader(request, 'content-length', options.contentLength)
    : request;
};

const makeJsonAudioRequest = (
  options: {
    audioBase64?: string;
    contentLength?: string;
    mediaType?: string;
  } = {}
) => {
  const request = new Request('https://taskforceai.example/api/dictation/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audioBase64: options.audioBase64 ?? 'YXVkaW8=',
      mediaType: options.mediaType ?? 'audio/mp4',
    }),
  });
  return options.contentLength
    ? withServerHeader(request, 'content-length', options.contentLength)
    : request;
};

const makeJsonAudioStreamRequest = (chunk: Uint8Array): Request => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request('https://taskforceai.example/api/dictation/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
};

describe('dictation transcription route', () => {
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
      transcription: transcriptionMock,
    });
    transcribeMock.mockResolvedValue({ text: 'captured voice text' });
  });

  afterEach(() => {
    if (originalGatewayApiKey === undefined) {
      Reflect.deleteProperty(process.env, 'AI_GATEWAY_API_KEY');
      return;
    }
    process.env['AI_GATEWAY_API_KEY'] = originalGatewayApiKey;
  });

  it('transcribes uploaded dictation audio with xai/grok-stt', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'captured voice text' });
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'gateway-key' });
    expect(transcriptionMock).toHaveBeenCalledWith('xai/grok-stt');
    const transcribeOptions = transcribeMock.mock.calls[0]?.[0];
    expect(transcribeOptions?.model).not.toBe(transcriptionModel);
    expect(transcribeOptions?.model).toEqual(
      expect.objectContaining({
        modelId: 'xai/grok-stt',
        provider: 'gateway',
        specificationVersion: 'v4',
      })
    );
    expect(transcribeOptions?.audio).toBeInstanceOf(ArrayBuffer);
    expect(transcribeOptions?.maxRetries).toBe(1);
    await transcribeOptions?.model.doGenerate({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
    });
    const generateOptions = transcriptionDoGenerateMock.mock.calls[0]?.[0];
    expect(generateOptions?.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(generateOptions?.mediaType).toMatch(/^(audio|video)\/webm$/u);
  });

  it('transcribes native JSON base64 dictation audio with the same model path', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeJsonAudioRequest(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'captured voice text' });
    const transcribeOptions = transcribeMock.mock.calls[0]?.[0];
    expect(transcribeOptions?.model).toEqual(
      expect.objectContaining({
        modelId: 'xai/grok-stt',
        provider: 'gateway',
        specificationVersion: 'v4',
      })
    );
    expect(transcribeOptions?.audio).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(transcribeOptions?.audio)).toBe('audio');
    await transcribeOptions?.model.doGenerate({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
    });
    expect(transcriptionDoGenerateMock).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'audio/mp4' })
    );
  });

  it('requires authentication before transcribing audio', async () => {
    getApiRequestAuthSnapshotMock.mockResolvedValueOnce({
      isAuthenticated: false,
      sessionStatus: 'unauthenticated',
      user: null,
    });

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest(),
    });

    expect(response.status).toBe(401);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rejects csrf failures before transcribing audio', async () => {
    validateApiRequestCsrfMock.mockReturnValueOnce(
      Response.json({ error: 'CSRF token missing' }, { status: 403 })
    );

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CSRF token missing' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rate limits authenticated dictation before calling the model', async () => {
    consumeVoiceRequestLimitMock.mockReturnValueOnce({
      allowed: false,
      limit: 12,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    });

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest(),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Dictation transcription rate limit exceeded',
    });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rejects oversized dictation requests before parsing audio', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest({ contentLength: String(27 * 1024 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Dictation upload is too large' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rejects lengthless oversized JSON dictation bodies before parsing audio', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeJsonAudioStreamRequest(new Uint8Array(37 * 1024 * 1024)),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Dictation upload is too large' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported audio upload types before transcribing', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest({ name: 'dictation.txt', type: 'text/plain' }),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Unsupported audio file type' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported JSON audio types before transcribing', async () => {
    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeJsonAudioRequest({ mediaType: 'text/plain' }),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Unsupported audio file type' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('reports missing Gateway configuration without calling the model', async () => {
    Reflect.deleteProperty(process.env, 'AI_GATEWAY_API_KEY');

    const response = await capturedRouteConfig.server.handlers.POST({
      request: makeAudioRequest(),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Dictation is not configured for this deployment',
    });
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
