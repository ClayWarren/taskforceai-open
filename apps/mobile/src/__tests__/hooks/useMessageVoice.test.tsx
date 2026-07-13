import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

type PlaybackStatus = {
  currentTime: number;
  didJustFinish: boolean;
};

const playerState = {
  listener: null as ((status: PlaybackStatus) => void) | null,
  play: jest.fn(),
  pause: jest.fn(),
  remove: jest.fn(),
  removeListener: jest.fn(),
};

jest.mock('@taskforceai/client-runtime', () => {
  const actual = jest.requireActual('@taskforceai/client-runtime');
  return {
    ...actual,
    generateSpeechAudio: jest.fn(),
  };
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(),
}));

jest.mock('../../voice/voiceGatewayClient', () => ({
  createMobileVoiceGatewayRequestOptions: jest.fn(),
}));

jest.mock('../../utils/file-system', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(),
  writeBytesAsync: jest.fn(),
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

import { generateSpeechAudio } from '@taskforceai/client-runtime';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useMessageVoice } from '../../hooks/useMessageVoice';
import { deleteAsync, writeBytesAsync } from '../../utils/file-system';
import { createMobileVoiceGatewayRequestOptions } from '../../voice/voiceGatewayClient';

const mockGenerateSpeechAudio = generateSpeechAudio as jest.MockedFunction<
  typeof generateSpeechAudio
>;
const mockCreateAudioPlayer = createAudioPlayer as jest.MockedFunction<typeof createAudioPlayer>;
const mockSetAudioModeAsync = setAudioModeAsync as jest.MockedFunction<typeof setAudioModeAsync>;
const mockCreateMobileVoiceGatewayRequestOptions =
  createMobileVoiceGatewayRequestOptions as jest.MockedFunction<
    typeof createMobileVoiceGatewayRequestOptions
  >;
const mockWriteBytesAsync = writeBytesAsync as jest.MockedFunction<typeof writeBytesAsync>;
const mockDeleteAsync = deleteAsync as jest.MockedFunction<typeof deleteAsync>;

const flushPlaybackWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useMessageVoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    playerState.listener = null;
    playerState.play.mockClear();
    playerState.pause.mockClear();
    playerState.remove.mockClear();
    playerState.removeListener.mockClear();
    mockCreateAudioPlayer.mockImplementation(() => ({
      addListener: jest.fn((_event: string, listener: (status: PlaybackStatus) => void) => {
        playerState.listener = listener;
        return {
          remove: playerState.removeListener,
        };
      }),
      pause: playerState.pause,
      play: playerState.play,
      remove: playerState.remove,
    }) as ReturnType<typeof createAudioPlayer>);
    mockGenerateSpeechAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      format: 'mp3',
      mediaType: 'audio/mpeg',
    } as never);
    mockCreateMobileVoiceGatewayRequestOptions.mockResolvedValue({
      baseUrl: 'https://www.taskforceai.chat',
    } as never);
    mockWriteBytesAsync.mockResolvedValue(undefined as never);
    mockDeleteAsync.mockResolvedValue(undefined as never);
    mockSetAudioModeAsync.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts not speaking', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isPreparing).toBe(false);
    expect(result.current.elapsedSeconds).toBe(0);
    expect(result.current.voiceStatus).toBe('ready');
  });

  it('does nothing when content is empty', async () => {
    const { result } = await renderHook(() => useMessageVoice('   '));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(mockGenerateSpeechAudio).not.toHaveBeenCalled();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
  });

  it('generates and plays speech audio', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: true });
    expect(mockGenerateSpeechAudio).toHaveBeenCalledWith(
      'Hello world',
      expect.objectContaining({ baseUrl: 'https://www.taskforceai.chat' })
    );
    expect(mockWriteBytesAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/speech-\d+-0\.mp3$/),
      new Uint8Array([1, 2, 3])
    );
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(
      { uri: expect.stringMatching(/^file:\/\/\/cache\/speech-\d+-0\.mp3$/) },
      { updateInterval: 250 }
    );
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.isPreparing).toBe(false);

    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('shows preparing state before generated speech starts playing', async () => {
    let resolveSpeech:
      | ((audio: { bytes: Uint8Array; format: string; mediaType: string }) => void)
      | null = null;
    mockGenerateSpeechAudio.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSpeech = resolve;
      }) as never
    );
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.isPreparing).toBe(true);
    expect(playerState.play).not.toHaveBeenCalled();

    await act(async () => {
      resolveSpeech?.({
        bytes: new Uint8Array([1, 2, 3]),
        format: 'mp3',
        mediaType: 'audio/mpeg',
      });
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());
    expect(result.current.isPreparing).toBe(false);

    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('does not start duplicate playback from same-tick presses', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      const first = result.current.toggleSpeech();
      const second = result.current.toggleSpeech();
      await Promise.all([first, second]);
    });

    await waitFor(() => expect(mockGenerateSpeechAudio).toHaveBeenCalledTimes(1));
    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('starts playback from the first speech chunk while prefetching the next chunk', async () => {
    const firstChunk = 'First chunk sentence. '.repeat(6).trim();
    const secondChunk = 'Second chunk sentence. '.repeat(60).trim();
    const { result } = await renderHook(() => useMessageVoice(`${firstChunk}\n\n${secondChunk}`));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => {
      expect(playerState.play).toHaveBeenCalled();
      expect(mockGenerateSpeechAudio).toHaveBeenCalledTimes(2);
    });

    expect(mockGenerateSpeechAudio.mock.calls[0]?.[0]).toBe(firstChunk);
    expect(mockGenerateSpeechAudio.mock.calls[1]?.[0]).toBe(secondChunk);

    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('updates elapsed time from playback status', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());

    await act(() => {
      playerState.listener?.({ currentTime: 5.9, didJustFinish: false });
    });

    expect(result.current.elapsedSeconds).toBe(5);

    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('pauses and resumes active speech playback', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalledTimes(1));

    await act(() => {
      result.current.togglePlaybackPaused();
    });

    expect(playerState.pause).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(true);
    expect(result.current.isPreparing).toBe(false);

    await act(() => {
      result.current.togglePlaybackPaused();
    });

    expect(playerState.play).toHaveBeenCalledTimes(2);
    expect(result.current.isPaused).toBe(false);

    await act(async () => {
      result.current.stopSpeech();
      await flushPlaybackWork();
    });
  });

  it('keeps pause state false when playback has not started yet', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(() => {
      result.current.togglePlaybackPaused();
    });

    expect(playerState.pause).not.toHaveBeenCalled();
    expect(result.current.isPaused).toBe(false);
  });

  it('clears playback when audio finishes', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());

    await act(() => {
      playerState.listener?.({ currentTime: 6, didJustFinish: true });
    });

    await waitFor(() => expect(result.current.isSpeaking).toBe(false));
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isPreparing).toBe(false);
    expect(playerState.pause).toHaveBeenCalled();
    expect(playerState.remove).toHaveBeenCalled();
    expect(mockDeleteAsync).toHaveBeenCalled();
  });

  it('stops playback when already speaking', async () => {
    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());
    expect(result.current.isSpeaking).toBe(true);

    await act(async () => {
      await result.current.toggleSpeech();
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(playerState.pause).toHaveBeenCalled();
    expect(playerState.remove).toHaveBeenCalled();
  });

  it('shows alert when speech generation fails', async () => {
    mockGenerateSpeechAudio.mockRejectedValueOnce(new Error('speech failed') as never);
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { result } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Playback Error', 'speech failed'));
    await waitFor(() => expect(result.current.isSpeaking).toBe(false));
  });

  it('clears playback on unmount', async () => {
    const { result, unmount } = await renderHook(() => useMessageVoice('Hello world'));

    await act(async () => {
      await result.current.toggleSpeech();
    });

    await waitFor(() => expect(playerState.play).toHaveBeenCalled());

    await act(async () => {
      await unmount();
      await flushPlaybackWork();
    });

    expect(playerState.pause).toHaveBeenCalled();
    expect(playerState.remove).toHaveBeenCalled();
  });
});
