import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
    flushMicrotasks,
    lastAudioStreamConfig,
    loadUseRealtimeVoiceSession,
    MockWebSocket,
    mockBuildRealtimeVoiceSessionConfig,
    mockEnqueuePcmDelta,
    mockFetchRealtimeVoiceSetup,
    mockGetGatewayRealtimeProtocols,
    mockNormalizeRealtimeAudioBufferToBase64,
    mockRequestRecordingPermissionsAsync,
    mockStopPlayback,
    mockStream,
    mockTranscribeDictationAudio,
    resetRealtimeVoiceSessionHarness,
    restoreRealtimeVoiceSessionHarness,
} from './useRealtimeVoiceSession.test-harness';

const createDeferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
};

describe('useRealtimeVoiceSession', () => {
    beforeEach(resetRealtimeVoiceSessionHarness);
    afterEach(restoreRealtimeVoiceSessionHarness);

    it('opens a realtime socket and handles audio, transcript, and playback events', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result, unmount } = await renderHook(() => useRealtimeVoiceSession());

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

        await act(() => {
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

        await unmount();
        expect(mockStream.stop).toHaveBeenCalled();
        expect(mockStopPlayback).toHaveBeenCalled();
    });

    it('queues microphone audio until the realtime session is ready', async () => {
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = await renderHook(() => useRealtimeVoiceSession());

        await act(async () => {
            await result.current.connect();
        });

        const socket = MockWebSocket.instances[0];
        expect(mockStream.start).toHaveBeenCalled();

        await act(() => {
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
        const { result } = await renderHook(() => useRealtimeVoiceSession());
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

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        await act(() => {
            lastAudioStreamConfig?.onBuffer?.({
                channels: 1,
                data: speechBuffer,
                sampleRate: 24000,
            });
        });

        expect(result.current.messages).toEqual([]);

        await act(() => {
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

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        await act(async () => {
            socket?.message(JSON.stringify({ itemId: 'user-1', type: 'speech-started' }));
            await flushMicrotasks();
        });

        await act(() => {
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

        await act(() => {
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

        const commitIndex =
            socket?.sent.findIndex((message) => message === JSON.stringify({ type: 'input-audio-commit' })) ?? -1;
        expect(commitIndex).toBeGreaterThan(-1);
        expect(socket?.sent[commitIndex + 1]).toBe(JSON.stringify({ type: 'response-create' }));
    });

    it('falls back to dictation transcription when realtime user transcription is missing', async () => {
        mockTranscribeDictationAudio.mockResolvedValueOnce('Fallback user text' as never);
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

        const speechBuffer = new Float32Array(2_400).fill(0.12).buffer;
        const silenceBuffer = new Float32Array(24_000).buffer;

        await act(() => {
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

    it('starts fallback transcription for locally committed audio without a provider item id', async () => {
        jest.useFakeTimers();
        mockTranscribeDictationAudio.mockRejectedValueOnce(new Error('transcription failed'));
        const useRealtimeVoiceSession = loadUseRealtimeVoiceSession();
        const { result } = await renderHook(() => useRealtimeVoiceSession());
        await act(async () => { await result.current.connect(); });
        const socket = MockWebSocket.instances[0];
        await act(async () => {
            socket?.open();
            socket?.message(JSON.stringify({ type: 'session-created' }));
            await flushMicrotasks();
        });
        const speech = new Float32Array(2_400).fill(0.12).buffer;
        const silence = new Float32Array(24_000).buffer;
        act(() => {
            for (let index = 0; index < 3; index += 1) {
                lastAudioStreamConfig?.onBuffer?.({ channels: 1, data: speech, sampleRate: 16_000 });
            }
            lastAudioStreamConfig?.onBuffer?.({ channels: 1, data: silence, sampleRate: 16_000 });
        });

        await act(async () => {
            jest.runAllTimers();
            await flushMicrotasks();
            await flushMicrotasks();
        });

        expect(mockTranscribeDictationAudio).toHaveBeenCalled();
    });

});
