import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFetchRealtimeVoiceSetup = jest.fn();
const mockGetGatewayRealtimeProtocols = jest.fn((token: string) => [
    'ai-gateway-realtime.v1',
    `ai-gateway-auth.${token}`,
]);
const mockNormalizeRealtimeAudioBufferToBase64 = jest.fn(() => 'encoded-pcm');
const mockSerializeRealtimeVoiceEvent = jest.fn((event: unknown) => JSON.stringify(event));
const mockTranscribeDictationAudio = jest.fn();
const mockBuildRealtimeVoiceSessionConfig = jest.fn(() => ({
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

const mockRequestRecordingPermissionsAsync = jest.fn();
const mockSetAudioModeAsync = jest.fn();
const mockStream = {
    start: jest.fn(),
    stop: jest.fn(),
};
let lastAudioStreamConfig: { onBuffer?: (buffer: unknown) => void } | null = null;

jest.mock('expo-audio', () => ({
    __esModule: true,
    requestRecordingPermissionsAsync: mockRequestRecordingPermissionsAsync,
    setAudioModeAsync: mockSetAudioModeAsync,
    useAudioStream: jest.fn((config: { onBuffer?: (buffer: unknown) => void }) => {
        lastAudioStreamConfig = config;
        return {
            isStreaming: true,
            stream: mockStream,
        };
    }),
}));

const mockEnqueuePcmDelta = jest.fn();
const mockFlushPcmDeltas = jest.fn();
const mockStopPlayback = jest.fn();
let lastRealtimePlaybackOptions: { onIdle?: () => void } | null = null;

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

const mockCreateMobileVoiceGatewayRequestOptions = jest.fn();

jest.mock('../../voice/voiceGatewayClient', () => ({
    createMobileVoiceGatewayRequestOptions: mockCreateMobileVoiceGatewayRequestOptions,
}));

jest.mock('../../logger', () => ({
    createModuleLogger: () => ({
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    }),
}));

import { Alert } from 'react-native';

type Listener = (event: unknown) => void;

class MockWebSocket {
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

const flushMicrotasks = async () => {
    await Promise.resolve();
};

const loadUseRealtimeVoiceSession = () =>
    (require('../../hooks/useRealtimeVoiceSession') as typeof import('../../hooks/useRealtimeVoiceSession'))
        .useRealtimeVoiceSession;

describe("useRealtimeVoiceSession lifecycle", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
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
      });

  afterEach(() => {
          jest.useRealTimers();
          jest.restoreAllMocks();
          globalThis.WebSocket = originalWebSocket;
      });

  it('allows a quiet follow-up turn after a committed turn without provider transcription', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-started' }));
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-stopped' }));
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'audio-committed' }));
              await flushMicrotasks();
          });

          const commitCountBeforeFollowUp =
              socket?.sent.filter((message) => message === JSON.stringify({ type: 'input-audio-commit' }))
                  .length ?? 0;
          const quietSpeechBuffer = new Float32Array(2_400).fill(0.001).buffer;

          await act(() => {
              for (let index = 0; index < 24; index += 1) {
                  lastAudioStreamConfig?.onBuffer?.({
                      channels: 1,
                      data: quietSpeechBuffer,
                      sampleRate: 24000,
                  });
              }
          });

          const commitCountAfterFollowUp =
              socket?.sent.filter((message) => message === JSON.stringify({ type: 'input-audio-commit' }))
                  .length ?? 0;
          expect(commitCountAfterFollowUp).toBeGreaterThan(commitCountBeforeFollowUp);
      });

  it('commits immediately when server voice activity reports speech stopped', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-started' }));
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-stopped' }));
              await flushMicrotasks();
          });

          expect(result.current.messages).toEqual([]);
          expect(socket?.sent.slice(-2)).toEqual([
              JSON.stringify({ type: 'input-audio-commit' }),
              JSON.stringify({ type: 'response-create' }),
          ]);
      });

  it('handles realtime server events delivered as array buffers', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.message(
                  new TextEncoder().encode(
                      JSON.stringify({
                          itemId: 'user-1',
                          transcript: 'Hello from the phone',
                          type: 'input-transcription-completed',
                      })
                  ).buffer
              );
              await flushMicrotasks();
          });

          expect(result.current.messages).toEqual([
              {
                  id: 'user-user-1',
                  isEphemeral: false,
                  isStreaming: false,
                  role: 'user',
                  text: 'Hello from the phone',
              },
          ]);
      });

  it('keeps a finalized user transcript in the active placeholder position', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.message(JSON.stringify({ type: 'speech-started' }));
              socket?.message(JSON.stringify({ itemId: 'user-1', type: 'audio-committed' }));
              socket?.message(
                  JSON.stringify({ delta: 'Replying ', itemId: 'reply-1', type: 'audio-transcript-delta' })
              );
              socket?.message(
                  JSON.stringify({
                      itemId: 'reply-1',
                      transcript: 'Replying now.',
                      type: 'audio-transcript-done',
                  })
              );
              socket?.message(
                  JSON.stringify({
                      itemId: 'user-1',
                      transcript: 'Can you hear me?',
                      type: 'input-transcription-completed',
                  })
              );
              await flushMicrotasks();
          });

          expect(result.current.messages).toEqual([
              {
                  id: 'user-user-1',
                  isEphemeral: false,
                  isStreaming: false,
                  role: 'user',
                  text: 'Can you hear me?',
              },
              {
                  id: 'assistant-reply-1',
                  isStreaming: false,
                  role: 'assistant',
                  text: 'Replying now.',
              },
          ]);
      });

  it('clears the completed-session banner and transcripts when reset', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              socket?.message(
                  JSON.stringify({
                      itemId: 'user-1',
                      transcript: 'Start a voice chat',
                      type: 'input-transcription-completed',
                  })
              );
              await flushMicrotasks();
          });

          await act(async () => {
              socket?.close();
              await flushMicrotasks();
          });

          expect(result.current.endedDurationMs).not.toBeNull();
          expect(result.current.messages).toHaveLength(1);

          await act(() => {
              result.current.resetSession();
          });

          expect(result.current.endedDurationMs).toBeNull();
          expect(result.current.messages).toEqual([]);
      });

  it('pauses native capture for assistant audio and resumes after the response', async () => {
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          const startCallsBeforePlayback = mockStream.start.mock.calls.length;
          const stopCallsBeforePlayback = mockStream.stop.mock.calls.length;

          await act(async () => {
              socket?.message(JSON.stringify({ responseId: 'response-1', type: 'response-created' }));
              socket?.message(JSON.stringify({ delta: 'pcm-delta', itemId: 'reply-1', type: 'audio-delta' }));
              socket?.message(JSON.stringify({ itemId: 'reply-1', responseId: 'response-1', type: 'audio-done' }));
              await flushMicrotasks();
              await flushMicrotasks();
          });

          expect(mockStream.stop).toHaveBeenCalledTimes(stopCallsBeforePlayback + 1);
          expect(mockEnqueuePcmDelta).toHaveBeenCalledWith('pcm-delta');
          expect(mockFlushPcmDeltas).toHaveBeenCalledTimes(1);
          expect(mockStream.start).toHaveBeenCalledTimes(startCallsBeforePlayback);
          expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
              expect.objectContaining({
                  allowsRecording: false,
                  playsInSilentMode: true,
                  shouldRouteThroughEarpiece: false,
              })
          );

          await act(async () => {
              lastRealtimePlaybackOptions?.onIdle?.();
              await flushMicrotasks();
          });

          expect(mockStream.start).toHaveBeenCalledTimes(startCallsBeforePlayback + 1);
          expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
              expect.objectContaining({
                  allowsRecording: true,
                  playsInSilentMode: true,
                  shouldRouteThroughEarpiece: false,
              })
          );
      });

  it('times out realtime startup instead of staying stuck in connecting', async () => {
          jest.useFakeTimers();
          mockFetchRealtimeVoiceSetup.mockReturnValueOnce(new Promise(() => {}) as never);
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              void result.current.connect();
              await flushMicrotasks();
          });

          expect(result.current.status).toBe('connecting');
          expect(mockStream.start).toHaveBeenCalled();

          await act(() => {
              jest.advanceTimersByTime(12_000);
          });

          expect(result.current.status).toBe('error');
          expect(result.current.errorMessage).toBe(
              'Realtime voice took too long to connect. Please try again.'
          );
          expect(mockStream.stop).toHaveBeenCalled();
      });

  it('clears the startup timeout when the socket closes before readiness', async () => {
          jest.useFakeTimers();
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.close();
              await flushMicrotasks();
          });

          expect(result.current.status).toBe('disconnected');

          await act(() => {
              jest.advanceTimersByTime(12_000);
          });

          expect(result.current.status).toBe('disconnected');
          expect(result.current.errorMessage).toBeNull();
          expect(mockStream.stop).toHaveBeenCalled();
      });

  it('tears down socket errors before readiness without a stale timeout', async () => {
          jest.useFakeTimers();
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.error({});
              await flushMicrotasks();
          });

          expect(socket?.readyState).toBe(3);
          expect(result.current.status).toBe('error');
          expect(result.current.errorMessage).toBe('Realtime voice connection failed.');
          expect(mockStream.stop).toHaveBeenCalled();

          await act(() => {
              jest.advanceTimersByTime(12_000);
          });

          expect(result.current.status).toBe('error');
          expect(result.current.errorMessage).toBe('Realtime voice connection failed.');
      });

  it('tears down capture and socket on realtime server errors', async () => {
          jest.useFakeTimers();
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          const socket = MockWebSocket.instances[0];
          await act(async () => {
              socket?.open();
              socket?.message(JSON.stringify({ type: 'session-created' }));
              await flushMicrotasks();
          });

          expect(result.current.status).toBe('connected');

          await act(async () => {
              socket?.message(JSON.stringify({ type: 'error', message: 'Gateway rejected realtime voice.' }));
              await flushMicrotasks();
          });

          expect(socket?.readyState).toBe(3);
          expect(result.current.status).toBe('error');
          expect(result.current.errorMessage).toBe('Gateway rejected realtime voice.');
          expect(mockStream.stop).toHaveBeenCalled();
          expect(mockStopPlayback).toHaveBeenCalled();

          await act(() => {
              jest.advanceTimersByTime(12_000);
          });

          expect(result.current.errorMessage).toBe('Gateway rejected realtime voice.');
      });

  it('alerts when realtime voice is unavailable without WebSocket support', async () => {
          const alertSpy = jest.spyOn(Alert, 'alert');
          globalThis.WebSocket = undefined as unknown as typeof WebSocket;
          const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
          const { result } = await renderHook(() => useRealtimeVoiceSession());

          await act(async () => {
              await result.current.connect();
          });

          expect(alertSpy).toHaveBeenCalledWith(
              'Realtime Voice',
              'Realtime voice is unavailable on this device.'
          );
          expect(mockFetchRealtimeVoiceSetup).not.toHaveBeenCalled();
          expect(result.current.errorMessage).toBe('Realtime voice is unavailable on this device.');
      });
});
