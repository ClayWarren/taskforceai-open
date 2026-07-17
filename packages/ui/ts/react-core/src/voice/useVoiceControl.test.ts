import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../../../../tests/setup/dom';

import { logger } from '../shared/logger';
import { useVoiceControl } from './useVoiceControl';

const mockVoice = {
  manager: {
    cancel: vi.fn(),
    finishListening: vi.fn(),
    init: vi.fn(),
    listen: vi.fn(),
    record: vi.fn(),
  },
  error: null as Error | null,
};

void vi.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: (error: unknown) =>
    error instanceof Error && error.message === 'Voice input cancelled.',
}));

void vi.mock('@taskforceai/react-core/useVoice', () => ({
  useVoice: () => mockVoice,
}));

describe('useVoiceControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoice.error = null;
    mockVoice.manager.init.mockResolvedValue(undefined);
    mockVoice.manager.listen.mockResolvedValue(' hello from voice ');
    mockVoice.manager.cancel.mockResolvedValue(undefined);
    mockVoice.manager.finishListening.mockResolvedValue(undefined);
    mockVoice.manager.record.mockResolvedValue({
      data: 'QQ==',
      format: 'wav',
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('converts recorded audio into a file before invoking the callback', async () => {
    const setErrorMessage = vi.fn();
    const onAudioCaptureFile = vi.fn();

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onAudioCaptureFile,
        mode: 'audio',
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(mockVoice.manager.init).toHaveBeenCalledTimes(1);
    expect(mockVoice.manager.record).toHaveBeenCalledTimes(1);
    expect(onAudioCaptureFile).toHaveBeenCalledTimes(1);

    const firstCall = onAudioCaptureFile.mock.calls[0];
    expect(firstCall).toBeDefined();
    const capturedFile = firstCall?.[0] as File;
    expect(capturedFile).toBeInstanceOf(File);
    expect(capturedFile.name).toBe('voice-recording.wav');
    expect(capturedFile.type).toBe('audio/wav');
    expect(setErrorMessage).not.toHaveBeenCalled();
  });

  it('captures transcript mode and ignores blank transcripts', async () => {
    const setErrorMessage = vi.fn();
    const onTranscript = vi.fn();
    const { result, rerender } = renderHook(
      ({ transcriptHandler }: { transcriptHandler: (text: string) => void }) =>
        useVoiceControl({
          setErrorMessage,
          onTranscript: transcriptHandler,
        }),
      { initialProps: { transcriptHandler: onTranscript } }
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(onTranscript).toHaveBeenCalledWith(' hello from voice ');
    expect(result.current.isListening).toBe(false);

    const nextTranscript = vi.fn();
    mockVoice.manager.listen.mockResolvedValueOnce('   ');
    rerender({ transcriptHandler: nextTranscript });

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(nextTranscript).not.toHaveBeenCalled();
  });

  it('cancels an active listen and on unmount', async () => {
    const setErrorMessage = vi.fn();
    let resolveListen: (value: string) => void = () => undefined;
    mockVoice.manager.listen.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveListen = resolve;
        })
    );

    const { result, unmount } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      void result.current.handleVoiceButtonClick();
      await Promise.resolve();
    });

    expect(result.current.isListening).toBe(true);

    await act(async () => {
      await result.current.handleVoiceButtonClick();
      resolveListen('');
      await Promise.resolve();
    });

    expect(mockVoice.manager.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(false);

    unmount();
    expect(mockVoice.manager.cancel).toHaveBeenCalledTimes(2);
  });

  it('reports cancellation failures during unmount cleanup', async () => {
    const cleanupError = new Error('cleanup failed');
    mockVoice.manager.cancel.mockRejectedValueOnce(cleanupError);

    const { unmount } = renderHook(() =>
      useVoiceControl({
        setErrorMessage: vi.fn(),
        onTranscript: vi.fn(),
      })
    );

    unmount();
    await waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith('Voice cancellation during cleanup failed', {
        error: cleanupError,
      })
    );
  });

  it('accepts an active listen without cancelling it', async () => {
    const setErrorMessage = vi.fn();
    let resolveListen: (value: string) => void = () => undefined;
    mockVoice.manager.listen.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveListen = resolve;
        })
    );
    const onTranscript = vi.fn();

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript,
      })
    );

    await act(async () => {
      void result.current.handleVoiceButtonClick();
      await Promise.resolve();
    });

    expect(result.current.isListening).toBe(true);

    await act(async () => {
      await result.current.acceptVoiceInput();
      resolveListen('accepted transcript');
      await Promise.resolve();
    });

    expect(mockVoice.manager.finishListening).toHaveBeenCalledTimes(1);
    expect(mockVoice.manager.cancel).not.toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledWith('accepted transcript');
  });

  it('falls back to cancel when accepting voice input without finishListening support', async () => {
    const setErrorMessage = vi.fn();
    const originalFinishListening = mockVoice.manager.finishListening;
    (mockVoice.manager as unknown as { finishListening?: unknown }).finishListening = undefined;

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.acceptVoiceInput();
    });

    expect(mockVoice.manager.cancel).toHaveBeenCalledTimes(1);
    (mockVoice.manager as unknown as { finishListening?: unknown }).finishListening =
      originalFinishListening;
  });

  it('accepts an active audio recording without cancelling it', async () => {
    const setErrorMessage = vi.fn();
    let resolveRecord: (value: { data: string; format: string }) => void = () => undefined;
    mockVoice.manager.record.mockImplementation(
      () =>
        new Promise<{ data: string; format: string }>((resolve) => {
          resolveRecord = resolve;
        })
    );
    const onAudioCaptureFile = vi.fn();

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        mode: 'audio',
        onAudioCaptureFile,
      })
    );

    await act(async () => {
      void result.current.handleVoiceButtonClick();
      await Promise.resolve();
    });

    expect(result.current.isListening).toBe(true);

    await act(async () => {
      await result.current.acceptVoiceInput();
    });

    expect(mockVoice.manager.finishListening).toHaveBeenCalledTimes(1);
    expect(mockVoice.manager.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveRecord({ data: 'QQ==', format: 'wav' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onAudioCaptureFile).toHaveBeenCalledTimes(1);
      expect(result.current.isListening).toBe(false);
    });
  });

  it('does not surface user cancellation as an error', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.manager.listen.mockRejectedValueOnce(new Error('Voice input cancelled.'));

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it('reports offline transcript, init, listen, and conversion failures', async () => {
    const setErrorMessage = vi.fn();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const { result, rerender } = renderHook(
      ({ mode }: { mode?: 'transcript' | 'audio' }) =>
        useVoiceControl({
          setErrorMessage,
          mode,
          onTranscript: vi.fn(),
          onAudioCaptureFile: () => {
            throw new Error('conversion failed');
          },
        }),
      { initialProps: { mode: undefined as 'transcript' | 'audio' | undefined } }
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith(
      'Speech recognition requires an internet connection. You are currently offline.'
    );

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    mockVoice.error = new Error('microphone unavailable');
    mockVoice.manager.init.mockRejectedValueOnce(new Error('init failed'));
    rerender({ mode: undefined });

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('microphone unavailable');

    mockVoice.error = null;
    mockVoice.manager.listen.mockRejectedValueOnce(new Error('Permission denied'));

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('Permission denied');

    rerender({ mode: 'audio' });

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('conversion failed');
  });

  it('prefers voiceError when initialization fails', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.error = new Error('microphone unavailable');
    mockVoice.manager.init.mockRejectedValueOnce(new Error('init failed'));

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('microphone unavailable');
  });

  it('uses a generic message when initialization fails without details', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.manager.init.mockRejectedValueOnce('init failed');

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('Voice input is unavailable in this browser.');
  });

  it('uses a generic message when initialization fails with a blank Error', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.manager.init.mockRejectedValueOnce(new Error());

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(setErrorMessage).toHaveBeenCalledWith('Voice input is unavailable in this browser.');
  });

  it('logs permission failures without treating them as fatal conversion errors', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.manager.listen.mockRejectedValueOnce(new Error('Permission denied'));

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(setErrorMessage).toHaveBeenCalledWith('Permission denied');
  });

  it('logs non-permission voice capture failures as errors', async () => {
    const setErrorMessage = vi.fn();
    mockVoice.manager.listen.mockRejectedValueOnce(new Error('network failed'));

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onTranscript: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(logger.error).toHaveBeenCalledWith('Voice dictation failed', {
      error: expect.any(Error),
    });
    expect(setErrorMessage).toHaveBeenCalledWith('network failed');
  });

  it('reports audio conversion failures before invoking file processing', async () => {
    const setErrorMessage = vi.fn();
    const onAudioCaptureFile = vi.fn();
    mockVoice.manager.record.mockResolvedValueOnce({
      data: 'not valid base64 %',
      format: 'wav',
    });

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        mode: 'audio',
        onAudioCaptureFile,
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(onAudioCaptureFile).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Voice recording conversion failed', {
      error: expect.any(Error),
    });
    expect(setErrorMessage).toHaveBeenCalledWith('Failed to process audio recording.');
  });

  it('passes raw audio captures through when no file callback is supplied', async () => {
    const setErrorMessage = vi.fn();
    const onAudioCapture = vi.fn();

    const { result } = renderHook(() =>
      useVoiceControl({
        setErrorMessage,
        onAudioCapture,
        mode: 'audio',
      })
    );

    await act(async () => {
      await result.current.handleVoiceButtonClick();
    });

    expect(onAudioCapture).toHaveBeenCalledWith({ data: 'QQ==', format: 'wav' });
    expect(setErrorMessage).not.toHaveBeenCalled();
  });
});
