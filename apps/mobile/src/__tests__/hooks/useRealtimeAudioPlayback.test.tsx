import { act, renderHook } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { deleteAsync, writeBytesAsync } from '../../utils/file-system';

import { useRealtimeAudioPlayback } from '../../hooks/useRealtimeAudioPlayback';

jest.mock('../../utils/file-system', () => ({
    cacheDirectory: 'file:///cache/',
    deleteAsync: jest.fn(),
    writeBytesAsync: jest.fn(),
}));

const mockCreateAudioPlayer = createAudioPlayer as jest.MockedFunction<typeof createAudioPlayer>;
const mockSetAudioMode = setAudioModeAsync as jest.MockedFunction<typeof setAudioModeAsync>;
const mockDelete = deleteAsync as jest.MockedFunction<typeof deleteAsync>;
const mockWriteBytes = writeBytesAsync as jest.MockedFunction<typeof writeBytesAsync>;

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
        mockSetAudioMode.mockResolvedValue(undefined);
        mockDelete.mockResolvedValue(undefined);
        mockWriteBytes.mockResolvedValue(undefined);
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

    it('returns to idle when an empty PCM delta is flushed', async () => {
        const onIdle = jest.fn();
        const { result } = await renderHook(() => useRealtimeAudioPlayback({ onIdle }));

        await act(async () => {
            result.current.enqueuePcmDelta('');
            await result.current.flushPcmDeltas();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(onIdle).toHaveBeenCalled();
    });

    it('returns to idle when WAV preparation fails', async () => {
        const onIdle = jest.fn();
        mockWriteBytes.mockRejectedValueOnce(new Error('disk full'));
        const { result } = await renderHook(() => useRealtimeAudioPlayback({ onIdle }));

        await act(async () => {
            result.current.enqueuePcmDelta('AAA=');
            await result.current.flushPcmDeltas();
        });

        expect(result.current.isPlaying).toBe(false);
        expect(onIdle).toHaveBeenCalled();
    });

    it('cleans up a completed player even when native release and file deletion fail', async () => {
        const player = createMockPlayer();
        player.pause = jest.fn(() => { throw new Error('pause failed'); });
        mockCreateAudioPlayer.mockReturnValueOnce(player);
        mockDelete.mockRejectedValueOnce(new Error('delete failed'));
        const { result } = await renderHook(() => useRealtimeAudioPlayback());

        await act(async () => {
            result.current.enqueuePcmDelta('AAA=');
            await result.current.flushPcmDeltas();
        });
        act(() => playbackStatusListener?.({ didJustFinish: true }));
        await act(async () => { await Promise.resolve(); });

        expect(player.pause).toHaveBeenCalled();
        expect(mockDelete).toHaveBeenCalled();
    });
});
