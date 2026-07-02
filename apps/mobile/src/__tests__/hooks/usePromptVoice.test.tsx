import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockVoiceManager = {
    init: jest.fn().mockResolvedValue(undefined as never),
    record: jest.fn().mockResolvedValue({
        data: 'YXVkaW8=',
        format: 'm4a',
        filename: 'voice-recording.m4a',
        mimeType: 'audio/mp4',
        uri: 'file:///tmp/voice-recording.m4a',
    } as never),
    finishListening: jest.fn().mockResolvedValue(undefined as never),
    cancel: jest.fn().mockResolvedValue(undefined as never),
};

jest.mock('@taskforceai/client-runtime', () => {
    const actual = jest.requireActual('@taskforceai/client-runtime');
    return {
        ...actual,
        transcribeDictationAudio: jest.fn(),
    };
});

jest.mock('@taskforceai/voice', () => ({
    isVoiceCancellationError: () => false,
    useVoice: () => ({ manager: mockVoiceManager, error: null }),
}));

jest.mock('../../voice/voiceGatewayClient', () => ({
    createMobileVoiceGatewayRequestOptions: jest.fn(),
}));

jest.mock('../../utils/file-system', () => ({
    deleteAsync: jest.fn(),
}));

jest.mock('../../logger', () => ({
    createModuleLogger: () => ({
        error: jest.fn(),
        warn: jest.fn(),
    }),
}));

import { transcribeDictationAudio } from '@taskforceai/client-runtime';
import { usePromptVoice } from '../../hooks/usePromptVoice';
import { deleteAsync } from '../../utils/file-system';
import { createMobileVoiceGatewayRequestOptions } from '../../voice/voiceGatewayClient';

const mockTranscribeDictationAudio = transcribeDictationAudio as jest.MockedFunction<
    typeof transcribeDictationAudio
>;
const mockCreateMobileVoiceGatewayRequestOptions =
    createMobileVoiceGatewayRequestOptions as jest.MockedFunction<
        typeof createMobileVoiceGatewayRequestOptions
    >;
const mockDeleteAsync = deleteAsync as jest.MockedFunction<typeof deleteAsync>;

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
        mockVoiceManager.init.mockResolvedValue(undefined as never);
        mockVoiceManager.record.mockResolvedValue({
            data: 'YXVkaW8=',
            format: 'm4a',
            filename: 'voice-recording.m4a',
            mimeType: 'audio/mp4',
            uri: 'file:///tmp/voice-recording.m4a',
        } as never);
        mockVoiceManager.finishListening.mockResolvedValue(undefined as never);
        mockVoiceManager.cancel.mockResolvedValue(undefined as never);
        mockTranscribeDictationAudio.mockResolvedValue('hello world' as never);
        mockCreateMobileVoiceGatewayRequestOptions.mockResolvedValue({
            baseUrl: 'https://www.taskforceai.chat',
        } as never);
        mockDeleteAsync.mockResolvedValue(undefined as never);
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
        expect(mockVoiceManager.record).toHaveBeenCalled();
        expect(mockTranscribeDictationAudio).toHaveBeenCalledWith(
            {
                data: 'YXVkaW8=',
                filename: 'voice-recording.m4a',
                format: 'm4a',
                mimeType: 'audio/mp4',
            },
            { baseUrl: 'https://www.taskforceai.chat' }
        );
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
        const recordResult = deferred<{
            data: string;
            format: string;
            uri: string;
            filename: string;
            mimeType: string;
        }>();
        mockVoiceManager.record.mockReturnValueOnce(recordResult.promise as never);
        const onTranscript = jest.fn();

        const { result, unmount } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            void result.current.startListening(onTranscript);
            await Promise.resolve();
        });

        unmount();

        await act(async () => {
            recordResult.resolve({
                data: 'YXVkaW8=',
                format: 'm4a',
                filename: 'voice-recording.m4a',
                mimeType: 'audio/mp4',
                uri: 'file:///tmp/voice-recording.m4a',
            });
            await recordResult.promise;
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

    it('handles recording error', async () => {
        mockVoiceManager.record.mockRejectedValueOnce(new Error('recording failed'));
        const alertSpy = jest.spyOn(Alert, 'alert');
        const onTranscript = jest.fn();

        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.startListening(onTranscript);
        });

        expect(alertSpy).toHaveBeenCalledWith('Voice Input', 'recording failed');
        expect(result.current.isListening).toBe(false);
    });

    it('does not invoke transcript callback for empty transcription', async () => {
        mockTranscribeDictationAudio.mockResolvedValueOnce('   ' as never);
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

    it('acceptListening finishes the active recording', async () => {
        const { result } = renderHook(() => usePromptVoice(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.acceptListening();
        });

        expect(mockVoiceManager.finishListening).toHaveBeenCalled();
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
