import { jest } from '@jest/globals';

export const mockFetchRealtimeVoiceSetup = jest.fn();
export const mockGetGatewayRealtimeProtocols = jest.fn((token: string) => [
  'ai-gateway-realtime.v1',
  `ai-gateway-auth.${token}`,
]);
export const mockNormalizeRealtimeAudioBufferToBase64 = jest.fn(() => 'encoded-pcm');
const mockSerializeRealtimeVoiceEvent = jest.fn((event: unknown) => JSON.stringify(event));
export const mockTranscribeDictationAudio = jest.fn();
export const mockBuildRealtimeVoiceSessionConfig = jest.fn(() => ({
  instructions: 'Talk like TaskForceAI.',
  modalities: ['text', 'audio'],
}));

jest.mock('@taskforceai/client-runtime', () => {
  const actualClientRuntime =
    jest.requireActual<typeof import('@taskforceai/client-runtime')>('@taskforceai/client-runtime');
  return {
    __esModule: true,
    RealtimeVoiceAudioSender: actualClientRuntime.RealtimeVoiceAudioSender,
    RealtimeVoiceAudioQueue: actualClientRuntime.RealtimeVoiceAudioQueue,
    RealtimeVoiceSetupPrefetchCache: actualClientRuntime.RealtimeVoiceSetupPrefetchCache,
    RealtimeVoiceSocketController: actualClientRuntime.RealtimeVoiceSocketController,
    RealtimeVoiceTranscriptController: actualClientRuntime.RealtimeVoiceTranscriptController,
    REALTIME_INPUT_SAMPLE_RATE: 24000,
    applyRealtimeVoiceTranscriptEvent: actualClientRuntime.applyRealtimeVoiceTranscriptEvent,
    attachRealtimeVoiceSocketHandlers: actualClientRuntime.attachRealtimeVoiceSocketHandlers,
    arrayBufferToBase64: actualClientRuntime.arrayBufferToBase64,
    buildRealtimeVoiceSessionConfig: mockBuildRealtimeVoiceSessionConfig,
    fetchRealtimeVoiceSetup: mockFetchRealtimeVoiceSetup,
    getBase64DecodedByteLength: actualClientRuntime.getBase64DecodedByteLength,
    getGatewayRealtimeProtocols: mockGetGatewayRealtimeProtocols,
    mergeBase64Uint8ArrayChunks: actualClientRuntime.mergeBase64Uint8ArrayChunks,
    normalizeRealtimeAudioBufferToBase64: mockNormalizeRealtimeAudioBufferToBase64,
    parseRealtimeVoiceServerEvent: actualClientRuntime.parseRealtimeVoiceServerEvent,
    pcm16BytesToWavBytes: actualClientRuntime.pcm16BytesToWavBytes,
    serializeRealtimeVoiceEvent: mockSerializeRealtimeVoiceEvent,
    transcribeDictationAudio: mockTranscribeDictationAudio,
  };
});

export const mockRequestRecordingPermissionsAsync = jest.fn();
export const mockSetAudioModeAsync = jest.fn();
export const mockStream = { start: jest.fn(), stop: jest.fn() };
export let lastAudioStreamConfig: { onBuffer?: (buffer: unknown) => void } | null = null;

jest.mock('expo-audio', () => ({
  __esModule: true,
  requestRecordingPermissionsAsync: mockRequestRecordingPermissionsAsync,
  setAudioModeAsync: mockSetAudioModeAsync,
  useAudioStream: jest.fn((config: { onBuffer?: (buffer: unknown) => void }) => {
    lastAudioStreamConfig = config;
    return { isStreaming: true, stream: mockStream };
  }),
}));

export const mockEnqueuePcmDelta = jest.fn();
export const mockFlushPcmDeltas = jest.fn();
export const mockStopPlayback = jest.fn();
export let lastRealtimePlaybackOptions: { onIdle?: () => void } | null = null;

jest.mock('../../hooks/useRealtimeAudioPlayback', () => ({
  useRealtimeAudioPlayback: (options?: { onIdle?: () => void }) => {
    lastRealtimePlaybackOptions = options ?? null;
    return {
      enqueuePcmDelta: mockEnqueuePcmDelta,
      flushPcmDeltas: mockFlushPcmDeltas,
      isPlaying: false,
      stopPlayback: mockStopPlayback,
    };
  },
}));

export const mockCreateMobileVoiceGatewayRequestOptions = jest.fn();

jest.mock('../../voice/voiceGatewayClient', () => ({
  createMobileVoiceGatewayRequestOptions: mockCreateMobileVoiceGatewayRequestOptions,
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({ debug: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

type Listener = (event: unknown) => void;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  private listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly url: string,
    readonly protocols?: string | string[]
  ) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit('close', {});
  }

  error(payload: unknown = {}) {
    this.emit('error', payload);
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }

  message(data: unknown) {
    this.emit('message', { data });
  }

  private emit(event: string, payload: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

export const resetRealtimeVoiceSessionHarness = () => {
  jest.clearAllMocks();
  MockWebSocket.instances = [];
  lastAudioStreamConfig = null;
  lastRealtimePlaybackOptions = null;
  mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockSetAudioModeAsync.mockResolvedValue(undefined as never);
  mockStream.start.mockResolvedValue(undefined as never);
  mockStream.stop.mockReturnValue(undefined as never);
  mockFlushPcmDeltas.mockResolvedValue(undefined as never);
  mockTranscribeDictationAudio.mockResolvedValue('Fallback transcript' as never);
  mockCreateMobileVoiceGatewayRequestOptions.mockResolvedValue({
    baseUrl: 'https://www.taskforceai.chat',
  } as never);
  mockFetchRealtimeVoiceSetup.mockResolvedValue({
    token: 'voice-token',
    tools: [{ name: 'search' }],
    url: 'wss://voice.example/realtime',
  } as never);
  globalThis.WebSocket = MockWebSocket as typeof WebSocket;
};

export const restoreRealtimeVoiceSessionHarness = () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.WebSocket = originalWebSocket;
};

export const flushMicrotasks = async () => {
  await Promise.resolve();
};

export const loadUseRealtimeVoiceSession = () =>
  (require('../../hooks/useRealtimeVoiceSession') as typeof import('../../hooks/useRealtimeVoiceSession'))
    .useRealtimeVoiceSession;
