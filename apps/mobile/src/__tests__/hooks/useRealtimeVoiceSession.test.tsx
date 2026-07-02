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
    const actual = jest.requireActual('@taskforceai/client-runtime');
    return {
        ...actual,
        REALTIME_INPUT_SAMPLE_RATE: 24000,
        buildRealtimeVoiceSessionConfig: mockBuildRealtimeVoiceSessionConfig,
        fetchRealtimeVoiceSetup: mockFetchRealtimeVoiceSetup,
        getGatewayRealtimeProtocols: mockGetGatewayRealtimeProtocols,
        normalizeRealtimeAudioBufferToBase64: mockNormalizeRealtimeAudioBufferToBase64,
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

const createDeferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

const loadUseRealtimeVoiceSession = () =>
    (require('../../hooks/useRealtimeVoiceSession') as typeof import('../../hooks/useRealtimeVoiceSession'))
        .useRealtimeVoiceSession;

describe('useRealtimeVoiceSession', () => {
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

    it('opens a realtime socket and handles audio, transcript, and playback events', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result, unmount } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: 'https://www.taskforceai.chat',
                sessionConfig: expect.objectContaining({
                    instructions: 'Talk like TaskForceAI.',
                }),
                signal: expect.any(AbortSignal),
            })
        );
        expect(mockBuildRealtimeVoiceSessionConfig).toHaveBeenCalledWith();
        expect(mockGetGatewayRealtimeProtocols).toHaveBeenCalledWith('voice-token');

        const socket = MockWebSocket.instances[0];
        expect(socket?.url).toBe('wss://voice.example/realtime');
        expect(socket?.protocols).toEqual(['ai-gateway-realtime.v1', 'ai-gateway-auth.voice-token']);

        await act(async () => {
            socket?.open();
            await flushMicrotasks();
        });

        expect(mockStream.start).toHaveBeenCalled();
        expect(socket?.sent[0]).toBe(
            JSON.stringify({
                type: 'session-update',
                config: {
                    instructions: 'Talk like TaskForceAI.',
                    modalities: ['text', 'audio'],
                    tools: [{ name: 'search' }],
                },
            })
        );

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: new Float32Array([0.03, 0.04, 0.05]).buffer,
                sampleRate: 24000,
            });
        });

        expect(mockNormalizeRealtimeAudioBufferToBase64).toHaveBeenCalledWith(
            expect.anything(),
            {
                inputEncoding: 'float32',
                inputChannels: 1,
                inputSampleRate: 24000,
                outputSampleRate: 24000,
            }
        );
        expect(socket?.sent).toEqual([
            JSON.stringify({
                type: 'session-update',
                config: {
                    instructions: 'Talk like TaskForceAI.',
                    modalities: ['text', 'audio'],
                    tools: [{ name: 'search' }],
                },
            }),
        ]);

        await act(async () => {
            socket?.message(JSON.stringify({ type: 'session-created' }));
            socket?.message(
                JSON.stringify({
                    itemId: 'user-1',
                    transcript: 'Build this flow',
                    type: 'input-transcription-completed',
                })
            );
            socket?.message(JSON.stringify({ delta: 'Working ', itemId: 'reply-1', type: 'text-delta' }));
            socket?.message(
                JSON.stringify({ delta: 'on it', itemId: 'reply-1', type: 'audio-transcript-delta' })
            );
            socket?.message(JSON.stringify({ delta: 'pcm-delta', type: 'audio-delta' }));
            socket?.message(
                JSON.stringify({
                    itemId: 'reply-1',
                    transcript: 'Working on it.',
                    type: 'audio-transcript-done',
                })
            );
            await flushMicrotasks();
        });

        expect(socket?.sent).toContain(
            JSON.stringify({
                type: 'input-audio-append',
                audio: 'encoded-pcm',
            })
        );
        expect(result.current.status).toBe('connected');
        expect(result.current.isCapturing).toBe(true);
        expect(result.current.messages).toEqual([
            {
                id: 'user-user-1',
                isEphemeral: false,
                isStreaming: false,
                role: 'user',
                text: 'Build this flow',
            },
            {
                id: 'assistant-reply-1',
                isStreaming: false,
                role: 'assistant',
                text: 'Working on it.',
            },
        ]);
        expect(mockEnqueuePcmDelta).toHaveBeenCalledWith('pcm-delta');

        unmount();
        expect(mockStream.stop).toHaveBeenCalled();
        expect(mockStopPlayback).toHaveBeenCalled();
    });

    it('queues microphone audio until the realtime session is ready', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        expect(mockStream.start).toHaveBeenCalled();

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: new Float32Array([0.03, 0.04, 0.05]).buffer,
                sampleRate: 24000,
            });
        });

        expect(socket?.sent).toEqual([]);

        await act(async () => {
            socket?.open();
            await flushMicrotasks();
        });

        expect(socket?.sent).toEqual([
            JSON.stringify({
                type: 'session-update',
                config: {
                    instructions: 'Talk like TaskForceAI.',
                    modalities: ['text', 'audio'],
                    tools: [{ name: 'search' }],
                },
            }),
        ]);

        await act(async () => {
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });

        expect(result.current.status).toBe('connected');
        expect(socket?.sent).toEqual([
            JSON.stringify({
                type: 'session-update',
                config: {
                    instructions: 'Talk like TaskForceAI.',
                    modalities: ['text', 'audio'],
                    tools: [{ name: 'search' }],
                },
            }),
            JSON.stringify({
                type: 'input-audio-append',
                audio: 'encoded-pcm',
            }),
        ]);
    });

    it('starts realtime setup before microphone permission resolves', async () => {
        const permissionsDeferred = createDeferred<{ granted: boolean }>();
        const setupDeferred = createDeferred<{
            token: string;
            tools: unknown[];
            url: string;
        }>();
        mockRequestRecordingPermissionsAsync.mockReturnValueOnce(
            permissionsDeferred.promise as never
        );
        mockFetchRealtimeVoiceSetup.mockReturnValueOnce(setupDeferred.promise as never);

        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());
        let connectPromise!: Promise<void>;

        await act(async () => {
            connectPromise = result.current.connect();
            await flushMicrotasks();
            await flushMicrotasks();
        });

        expect(mockFetchRealtimeVoiceSetup).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionConfig: expect.objectContaining({
                    instructions: 'Talk like TaskForceAI.',
                }),
                signal: expect.any(AbortSignal),
            })
        );
        expect(mockStream.start).not.toHaveBeenCalled();

        permissionsDeferred.resolve({ granted: true });
        setupDeferred.resolve({
            token: 'voice-token',
            tools: [],
            url: 'wss://voice.example/realtime',
        });

        await act(async () => {
            await connectPromise;
        });

        expect(mockStream.start).toHaveBeenCalled();
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('commits a local voice turn after trailing silence on native audio', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        await act(async () => {
            socket?.open();
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
        });

        expect(result.current.messages).toEqual([]);

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: silenceBuffer,
                sampleRate: 24000,
            });
        });

        const commitIndex =
            socket?.sent.findIndex((message) => message === JSON.stringify({ type: 'input-audio-commit' })) ?? -1;
        expect(result.current.messages).toEqual([]);
        expect(commitIndex).toBeGreaterThan(-1);
        expect(socket?.sent[commitIndex + 1]).toBe(JSON.stringify({ type: 'response-create' }));
    });

    it('keeps local turn commit as a fallback after server speech events', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        await act(async () => {
            socket?.open();
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        await act(async () => {
            socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-started' }));
            await flushMicrotasks();
        });

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
        });

        await act(async () => {
            socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-stopped' }));
            await flushMicrotasks();
        });

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: silenceBuffer,
                sampleRate: 24000,
            });
        });

        const commitIndex =
            socket?.sent.findIndex((message) => message === JSON.stringify({ type: 'input-audio-commit' })) ?? -1;
        expect(result.current.messages).toEqual([
            {
                id: 'user-user-1',
                isEphemeral: false,
                isStreaming: false,
                role: 'user',
                text: 'Fallback transcript',
            },
        ]);
        expect(commitIndex).toBeGreaterThan(-1);
        expect(socket?.sent[commitIndex + 1]).toBe(JSON.stringify({ type: 'response-create' }));
    });

    it('forces a turn commit when native audio activity arrives without VAD events', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        await act(async () => {
            socket?.open();
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });

        const quietSpeechBuffer = new Float32Array(2_400).fill(0.001).buffer;

        act(() => {
            for (let index = 0; index < 24; index += 1) {
                lastAudioStreamConfig?.onBuffer?.({
                    channels: 1,
                    data: quietSpeechBuffer,
                    sampleRate: 24000,
                });
            }
        });

        const commitIndex =
            socket?.sent.findIndex((message) => message === JSON.stringify({ type: 'input-audio-commit' })) ?? -1;
        expect(commitIndex).toBeGreaterThan(-1);
        expect(socket?.sent[commitIndex + 1]).toBe(JSON.stringify({ type: 'response-create' }));
    });

    it('falls back to dictation transcription when realtime user transcription is missing', async () => {
        mockTranscribeDictationAudio.mockResolvedValueOnce('Fallback user text' as never);
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        await act(async () => {
            socket?.open();
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: silenceBuffer,
                sampleRate: 24000,
            });
        });

        await act(async () => {
            socket?.message(JSON.stringify({ itemId: 'user-1', type: 'audio-committed' }));
            await flushMicrotasks();
            await flushMicrotasks();
            await flushMicrotasks();
        });

        expect(mockTranscribeDictationAudio).toHaveBeenCalledWith(
            expect.objectContaining({
                filename: 'realtime-voice.wav',
                mediaType: 'audio/wav',
            }),
            expect.objectContaining({
                baseUrl: 'https://www.taskforceai.chat',
            })
        );
        expect(result.current.messages).toEqual([
            {
                id: 'user-user-1',
                isEphemeral: false,
                isStreaming: false,
                role: 'user',
                text: 'Fallback user text',
            },
        ]);
    });

    it('allows a quiet follow-up turn after a committed turn without provider transcription', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

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

        act(() => {
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
        const { result } = renderHook(() => useRealtimeVoiceSession());

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
        const { result } = renderHook(() => useRealtimeVoiceSession());

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
        const { result } = renderHook(() => useRealtimeVoiceSession());

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
        const { result } = renderHook(() => useRealtimeVoiceSession());

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

        act(() => {
            result.current.resetSession();
        });

        expect(result.current.endedDurationMs).toBeNull();
        expect(result.current.messages).toEqual([]);
    });

    it('pauses native capture for assistant audio and resumes after the response', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

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
        const { result } = renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            void result.current.connect();
            await flushMicrotasks();
        });

        expect(result.current.status).toBe('connecting');
        expect(mockStream.start).toHaveBeenCalled();

        act(() => {
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
        const { result } = renderHook(() => useRealtimeVoiceSession());

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

        act(() => {
            jest.advanceTimersByTime(12_000);
        });

        expect(result.current.status).toBe('disconnected');
        expect(result.current.errorMessage).toBeNull();
        expect(mockStream.stop).toHaveBeenCalled();
    });

    it('tears down socket errors before readiness without a stale timeout', async () => {
        jest.useFakeTimers();
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

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

        act(() => {
            jest.advanceTimersByTime(12_000);
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toBe('Realtime voice connection failed.');
    });

    it('tears down capture and socket on realtime server errors', async () => {
        jest.useFakeTimers();
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

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

        act(() => {
            jest.advanceTimersByTime(12_000);
        });

        expect(result.current.errorMessage).toBe('Gateway rejected realtime voice.');
    });

    it('alerts when realtime voice is unavailable without WebSocket support', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert');
        globalThis.WebSocket = undefined as unknown as typeof WebSocket;
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = renderHook(() => useRealtimeVoiceSession());

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
