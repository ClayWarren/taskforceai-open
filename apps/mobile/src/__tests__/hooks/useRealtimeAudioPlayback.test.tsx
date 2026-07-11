import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createAudioPlayer } from 'expo-audio';

import { useRealtimeAudioPlayback } from '../../hooks/useRealtimeAudioPlayback';

const mockCreateAudioPlayer = createAudioPlayer as jest.MockedFunction<typeof createAudioPlayer>;

describe('useRealtimeAudioPlayback', () => {
    let playbackStatusListener: ((status: { didJustFinish?: boolean }) => void) | null = null;
    const createMockPlayer = () =>
        ({
            addListener: jest.fn((event: string, listener: typeof playbackStatusListener) => {
                if (event === 'playbackStatusUpdate') {
                    playbackStatusListener = listener;
                }
                return { remove: jest.fn() };
            }),
            pause: jest.fn(),
            play: jest.fn(),
            remove: jest.fn(),
        }) as ReturnType<typeof createAudioPlayer>;

    beforeEach(() => {
        jest.useFakeTimers();
        playbackStatusListener = null;
        mockCreateAudioPlayer.mockImplementation(() => createMockPlayer());
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('stays busy from the first PCM delta until queued playback finishes', async () => {
        const onIdle = jest.fn();
        const { result } = await renderHook(() => useRealtimeAudioPlayback({ onIdle }));

        await act(() => {
            result.current.enqueuePcmDelta('AAA=');
        });

        expect(result.current.isPlaying).toBe(true);
        expect(onIdle).not.toHaveBeenCalled();
        expect(mockCreateAudioPlayer).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.isPlaying).toBe(true);
        expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
        expect(onIdle).not.toHaveBeenCalled();

        await act(() => {
            playbackStatusListener?.({ didJustFinish: true });
        });

        expect(result.current.isPlaying).toBe(false);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('notifies idle when playback startup fails', async () => {
        const onIdle = jest.fn();
        mockCreateAudioPlayer.mockImplementationOnce(() => {
            throw new Error('native playback failed');
        });
        const { result } = await renderHook(() => useRealtimeAudioPlayback({ onIdle }));

        await act(() => {
            result.current.enqueuePcmDelta('AAA=');
        });

        await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    it('notifies idle when queued playback is stopped before flushing', async () => {
        const onIdle = jest.fn();
        const { result } = await renderHook(() => useRealtimeAudioPlayback({ onIdle }));

        await act(() => {
            result.current.enqueuePcmDelta('AAA=');
        });

        expect(result.current.isPlaying).toBe(true);

        await act(() => {
            result.current.stopPlayback();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(onIdle).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(300);
            await Promise.resolve();
        });

        expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    });

    it('flushes queued PCM deltas on demand', async () => {
        const { result } = await renderHook(() => useRealtimeAudioPlayback());

        await act(() => {
            result.current.enqueuePcmDelta('AAA=');
        });

        expect(mockCreateAudioPlayer).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.flushPcmDeltas();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    });
});
