import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockVoiceManager = {
  init: jest.fn().mockResolvedValue(undefined as never),
  speak: jest.fn().mockResolvedValue(undefined as never),
  cancel: jest.fn().mockResolvedValue(undefined as never),
};

const mockVoiceState = {
  manager: mockVoiceManager,
  status: 'ready' as const,
  error: null as Error | null,
};

jest.mock('@taskforceai/voice', () => ({
  isVoiceCancellationError: () => false,
  useVoice: () => mockVoiceState,
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

import { useMessageVoice } from '../../hooks/useMessageVoice';

describe('useMessageVoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVoiceState.status = 'ready';
    mockVoiceState.error = null;
    mockVoiceManager.init.mockResolvedValue(undefined as never);
    mockVoiceManager.speak.mockResolvedValue(undefined as never);
    mockVoiceManager.cancel.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts not speaking', () => {
    const { result } = renderHook(() => useMessageVoice('Hello world'));
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.voiceStatus).toBe('ready');
  });

  it('does nothing when content is empty', async () => {
    const { result } = renderHook(() => useMessageVoice('   '));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(mockVoiceManager.init).not.toHaveBeenCalled();
    expect(mockVoiceManager.speak).not.toHaveBeenCalled();
  });

  it('speaks content when not speaking', async () => {
    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(mockVoiceManager.init).toHaveBeenCalled();
    expect(mockVoiceManager.speak).toHaveBeenCalledWith('Hello world');
    expect(result.current.isSpeaking).toBe(false);
  });

  it('shows alert when voice status is error', async () => {
    mockVoiceState.status = 'error';
    mockVoiceState.error = new Error('Voice unavailable');
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(alertSpy).toHaveBeenCalledWith('Voice Unavailable', 'Voice unavailable');
    expect(mockVoiceManager.speak).not.toHaveBeenCalled();
  });

  it('shows alert with default message when voice error has no message', async () => {
    mockVoiceState.status = 'error';
    mockVoiceState.error = null;
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(alertSpy).toHaveBeenCalledWith('Voice Unavailable', 'Voice playback is unavailable.');
  });

  it('shows alert when speak fails', async () => {
    mockVoiceManager.speak.mockRejectedValueOnce(new Error('speak failed'));
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(alertSpy).toHaveBeenCalledWith('Playback Error', 'Unable to read the response aloud right now.');
    expect(result.current.isSpeaking).toBe(false);
  });

  it('shows alert when init fails', async () => {
    mockVoiceManager.init.mockRejectedValueOnce(new Error('init failed'));
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(alertSpy).toHaveBeenCalledWith('Playback Error', 'Unable to read the response aloud right now.');
    expect(result.current.isSpeaking).toBe(false);
  });

  it('cancels speech when already speaking', async () => {
    let _speakResolve: () => void;
    const speakPromise = new Promise<void>((resolve) => {
      _speakResolve = resolve;
    });
    mockVoiceManager.speak.mockReturnValueOnce(speakPromise as never);

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    act(() => {
      result.current.toggleSpeech();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isSpeaking).toBe(true);

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(mockVoiceManager.cancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('handles cancel error gracefully', async () => {
    mockVoiceManager.cancel.mockRejectedValueOnce(new Error('cancel failed'));

    const { result } = renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(result.current.isSpeaking).toBe(false);
    
    mockVoiceManager.speak.mockReturnValueOnce(new Promise(() => {}) as never);

    act(() => {
      result.current.toggleSpeech();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isSpeaking).toBe(true);

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(result.current.isSpeaking).toBe(false);
  });
});
