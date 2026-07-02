import { generateSpeechAudio, splitTextForSpeechGeneration } from '@taskforceai/client-runtime';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { createModuleLogger } from '../logger';
import { cacheDirectory, deleteAsync, writeBytesAsync } from '../utils/file-system';
import { createMobileVoiceGatewayRequestOptions } from '../voice/voiceGatewayClient';

const logger = createModuleLogger('useMessageVoice');
const READ_ALOUD_FIRST_CHUNK_CHARS = 180;
const READ_ALOUD_CHUNK_CHARS = 2_400;

type PlaybackSubscription = {
  remove: () => void;
};

export function useMessageVoice(content: string) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [voiceStatus] = useState<'ready'>('ready');
  const abortControllerRef = useRef<AbortController | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<PlaybackSubscription | null>(null);
  const currentPlaybackFileUriRef = useRef<string | null>(null);
  const playbackFileUrisRef = useRef<Set<string>>(new Set());

  const deletePlaybackFile = useCallback((fileUri: string) => {
    playbackFileUrisRef.current.delete(fileUri);
    void deleteAsync(fileUri, { idempotent: true }).catch((error) => {
      logger.warn('Failed to remove generated speech audio', { error });
    });
  }, []);

  const clearCurrentPlayer = useCallback(() => {
    playbackSubscriptionRef.current?.remove();
    playbackSubscriptionRef.current = null;

    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch (error) {
        logger.error('Failed to stop generated speech playback', { error });
      }
    }

    const currentPlaybackFileUri = currentPlaybackFileUriRef.current;
    currentPlaybackFileUriRef.current = null;
    if (currentPlaybackFileUri) {
      deletePlaybackFile(currentPlaybackFileUri);
    }
  }, [deletePlaybackFile]);

  const clearPlayback = useCallback((options: { abort?: boolean } = {}) => {
    if (options.abort !== false) {
      abortControllerRef.current?.abort();
    }
    abortControllerRef.current = null;
    clearCurrentPlayer();

    for (const fileUri of Array.from(playbackFileUrisRef.current)) {
      deletePlaybackFile(fileUri);
    }

    setIsSpeaking(false);
    setIsPaused(false);
    setIsPreparing(false);
    setElapsedSeconds(0);
  }, [clearCurrentPlayer, deletePlaybackFile]);

  const playSpeechFile = useCallback(
    async (fileUri: string, abortController: AbortController): Promise<void> => {
      if (abortController.signal.aborted) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          abortController.signal.removeEventListener('abort', handleAbort);
          clearCurrentPlayer();
          if (error) {
            reject(error);
            return;
          }
          resolve();
        };
        const handleAbort = () => settle();

        try {
          const player = createAudioPlayer({ uri: fileUri }, { updateInterval: 250 });
          playerRef.current = player;
          currentPlaybackFileUriRef.current = fileUri;
          playbackSubscriptionRef.current = player.addListener('playbackStatusUpdate', (status) => {
            setElapsedSeconds(Math.max(0, Math.floor(status.currentTime)));
            if (status.didJustFinish) {
              settle();
            }
          });
          abortController.signal.addEventListener('abort', handleAbort, { once: true });
          setIsPaused(false);
          player.play();
          setIsPreparing(false);
        } catch (error) {
          settle(error);
        }
      });
    },
    [clearCurrentPlayer]
  );

  const startSpeechPlayback = useCallback(
    async (abortController: AbortController) => {
      const chunks = splitTextForSpeechGeneration(content, {
        firstChunkChars: READ_ALOUD_FIRST_CHUNK_CHARS,
        chunkChars: READ_ALOUD_CHUNK_CHARS,
      });
      if (chunks.length === 0) {
        clearPlayback({ abort: false });
        return;
      }

      try {
        await setAudioModeAsync({ playsInSilentMode: true });
        const voiceGatewayOptions = await createMobileVoiceGatewayRequestOptions();

        const generateChunkFile = (chunk: string, index: number): Promise<string | null> => {
          const promise = generateSpeechAudio(chunk, {
            ...voiceGatewayOptions,
            signal: abortController.signal,
          }).then(async (audio) => {
            if (abortController.signal.aborted) {
              return null;
            }

            const fileUri = `${cacheDirectory}speech-${Date.now()}-${index}.${audio.format}`;
            await writeBytesAsync(fileUri, audio.bytes);
            if (abortController.signal.aborted) {
              void deleteAsync(fileUri, { idempotent: true });
              return null;
            }

            playbackFileUrisRef.current.add(fileUri);
            return fileUri;
          });
          promise.catch(() => undefined);
          return promise;
        };

        const playGeneratedChunks = async (
          index: number,
          currentChunkFilePromise: Promise<string | null>
        ): Promise<void> => {
          setIsPreparing(true);
          const fileUri = await currentChunkFilePromise;
          if (!fileUri || abortController.signal.aborted) {
            return;
          }

          const nextChunk = chunks[index + 1];
          const nextChunkFilePromise = nextChunk ? generateChunkFile(nextChunk, index + 1) : null;
          await playSpeechFile(fileUri, abortController);
          if (abortController.signal.aborted) {
            return;
          }

          if (nextChunkFilePromise) {
            await playGeneratedChunks(index + 1, nextChunkFilePromise);
          }
        };

        await playGeneratedChunks(0, generateChunkFile(chunks[0] ?? '', 0));

        clearPlayback({ abort: false });
      } catch (error) {
        if (!abortController.signal.aborted) {
          logger.error('Failed to speak message', { error });
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Unable to read the response aloud right now.';
          Alert.alert('Playback Error', message);
        }
        clearPlayback({ abort: false });
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [clearPlayback, content, playSpeechFile]
  );

  const toggleSpeech = useCallback(async () => {
    if (!content.trim()) {
      return;
    }

    if (isSpeaking) {
      clearPlayback();
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsSpeaking(true);
    setIsPreparing(true);
    void startSpeechPlayback(abortController);
  }, [clearPlayback, isSpeaking, content, startSpeechPlayback]);

  const togglePlaybackPaused = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }

    try {
      if (isPaused) {
        player.play();
        setIsPaused(false);
        return;
      }
      player.pause();
      setIsPaused(true);
    } catch (error) {
      logger.error('Failed to toggle generated speech playback', { error });
    }
  }, [isPaused]);

  useEffect(() => clearPlayback, [clearPlayback]);

  return {
    isSpeaking,
    isPaused,
    isPreparing,
    elapsedSeconds,
    stopSpeech: clearPlayback,
    togglePlaybackPaused,
    toggleSpeech,
    voiceStatus,
  };
}
