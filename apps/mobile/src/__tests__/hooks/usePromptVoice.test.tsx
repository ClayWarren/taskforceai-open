import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockVoiceManager = {
    init: jest.fn().mockResolvedValue(undefined as never),
    listen: jest.fn().mockResolvedValue('hello world' as never),
    cancel: jest.fn().mockResolvedValue(undefined as never),
};

jest.mock('@taskforceai/voice', () => ({
    isVoiceCancellationError: () => false,
    useVoice: () => ({ manager: mockVoiceManager, error: null }),
}));

import { usePromptVoice } from '../../hooks/usePromptVoice';

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }: any) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

describe('usePromptVoice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('starts not listening', () => {
        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });
        expect(result.current.isListening).toBe(false);
        expect(result.current.transcriptionHint).toBeNull();
    });

    it('starts listening and receives transcription', async () => {
        const onTranscript = jest.fn();
        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(mockVoiceManager.init).toHaveBeenCalled();
        expect(mockVoiceManager.listen).toHaveBeenCalled();
        expect(onTranscript).toHaveBeenCalledWith('hello world');
        expect(result.current.isListening).toBe(false); // finished
        expect(result.current.transcriptionHint).toBe('Voice input added');
    });

    it('cancels voice on cleanup unmount', () => {
        const { unmount } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });
        unmount();
        expect(mockVoiceManager.cancel).toHaveBeenCalled();
    });

    it('does not publish transcription after unmount', async () => {
        const listenResult = deferred<string>();
        mockVoiceManager.listen.mockReturnValueOnce(listenResult.promise as never);
        const onTranscript = jest.fn();

        const { result, unmount } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            void result.current.startListening(onTranscript);
            await Promise.resolve();
        });

        unmount();

        await act(async () => {
            listenResult.resolve('late transcript');
            await listenResult.promise;
            await Promise.resolve();
        });

        expect(mockVoiceManager.cancel).toHaveBeenCalled();
        expect(onTranscript).not.toHaveBeenCalled();
    });

    it('shows alert when voice init fails', async () => {
        mockVoiceManager.init.mockRejectedValueOnce(new Error('no microphone'));
        const alertSpy = jest.spyOn(Alert, 'alert');
        const onTranscript = jest.fn();

        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(alertSpy).toHaveBeenCalledWith('Voice Unavailable', 'no microphone');
        expect(onTranscript).not.toHaveBeenCalled();
    });

    it('handles listen error', async () => {
        mockVoiceManager.listen.mockRejectedValueOnce(new Error('recognition failed'));
        const alertSpy = jest.spyOn(Alert, 'alert');
        const onTranscript = jest.fn();

        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(alertSpy).toHaveBeenCalledWith('Voice Input', 'recognition failed');
        expect(result.current.isListening).toBe(false);
    });

    it('does not invoke transcript callback for empty transcription', async () => {
        mockVoiceManager.listen.mockResolvedValueOnce('   ');
        const onTranscript = jest.fn();

        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(onTranscript).not.toHaveBeenCalled();
        expect(result.current.transcriptionHint).toBeNull();
    });

    it('stopListening cancels voice and sets isListening to false', async () => {
        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.stopListening();
        });

        expect(mockVoiceManager.cancel).toHaveBeenCalled();
        expect(result.current.isListening).toBe(false);
    });

    it('clears transcription hint after timeout', async () => {
        const onTranscript = jest.fn();
        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(result.current.transcriptionHint).toBe('Voice input added');

        act(() => {
            jest.advanceTimersByTime(3000);
        });

        expect(result.current.transcriptionHint).toBeNull();
    });
});
