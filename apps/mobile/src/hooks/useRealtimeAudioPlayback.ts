import {
  getBase64DecodedByteLength,
  mergeBase64Uint8ArrayChunks,
  pcm16BytesToWavBytes,
  REALTIME_OUTPUT_SAMPLE_RATE,
} from '@taskforceai/client-runtime';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createModuleLogger } from '../logger';
import { cacheDirectory, deleteAsync, writeBytesAsync } from '../utils/file-system';

const logger = createModuleLogger('useRealtimeAudioPlayback');
const FLUSH_DELAY_MS = 300;
const MIN_FLUSH_PCM_BYTES = Math.floor(REALTIME_OUTPUT_SAMPLE_RATE * 2 * 0.48);
const PLAYBACK_STATUS_INTERVAL_MS = 25;

type PlaybackSubscription = {
  remove: () => void;
};

type RealtimeAudioPlaybackOptions = {
  onIdle?: () => void;
};

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
  if (typeof globalThis.clearTimeout === 'function') {
    globalThis.clearTimeout(timer);
  }
};

export function useRealtimeAudioPlayback(options: RealtimeAudioPlaybackOptions = {}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const onIdleRef = useRef(options.onIdle);
  const pendingDeltasRef = useRef<string[]>([]);
  const queuedFilesRef = useRef<string[]>([]);
  const playerRef = useRef<AudioPlayer | null>(null);
  const playbackSubscriptionRef = useRef<PlaybackSubscription | null>(null);
  const currentPlaybackUriRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeltaBytesRef = useRef(0);
  const playbackModeReadyRef = useRef(false);
  const isStartingPlaybackRef = useRef(false);
  const playNextRef = useRef<() => Promise<void>>(async () => {});
  const sequenceRef = useRef(0);
  const generationRef = useRef(0);

  useEffect(() => {
    onIdleRef.current = options.onIdle;
  }, [options.onIdle]);

  const notifyIdle = useCallback(() => {
    onIdleRef.current?.();
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
        logger.warn('Failed to release realtime speech player', { error });
      }
    }

    const currentUri = currentPlaybackUriRef.current;
    currentPlaybackUriRef.current = null;
    if (currentUri) {
      void deleteAsync(currentUri, { idempotent: true }).catch((error) => {
        logger.warn('Failed to remove realtime speech chunk', { error });
      });
    }
  }, []);

  const playNext = useCallback(async () => {
    if (playerRef.current || isStartingPlaybackRef.current) {
      return;
    }

    const nextUri = queuedFilesRef.current.shift();
    if (!nextUri) {
      if (pendingDeltasRef.current.length > 0 || flushTimerRef.current) {
        return;
      }
      setIsPlaying(false);
      playbackModeReadyRef.current = false;
      notifyIdle();
      return;
    }

    const generation = generationRef.current;
    let shouldContinue = false;
    isStartingPlaybackRef.current = true;
    try {
      if (!playbackModeReadyRef.current) {
        await setAudioModeAsync({ playsInSilentMode: true });
        playbackModeReadyRef.current = true;
      }
      if (generation !== generationRef.current) {
        void deleteAsync(nextUri, { idempotent: true });
        return;
      }

      const player = createAudioPlayer({ uri: nextUri }, { updateInterval: PLAYBACK_STATUS_INTERVAL_MS });
      playerRef.current = player;
      currentPlaybackUriRef.current = nextUri;
      playbackSubscriptionRef.current = player.addListener('playbackStatusUpdate', (status) => {
        if (!status.didJustFinish) {
          return;
        }
        clearCurrentPlayer();
        void playNextRef.current();
      });
      setIsPlaying(true);
      player.play();
    } catch (error) {
      logger.warn('Failed to play realtime speech chunk', { error });
      clearCurrentPlayer();
      void deleteAsync(nextUri, { idempotent: true }).catch((deleteError) => {
        logger.warn('Failed to remove skipped realtime speech chunk', { error: deleteError });
      });
      shouldContinue = true;
    } finally {
      isStartingPlaybackRef.current = false;
    }

    if (shouldContinue) {
      await playNextRef.current();
    }
  }, [clearCurrentPlayer, notifyIdle]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const flushPendingDeltas = useCallback(async () => {
    const chunks = pendingDeltasRef.current.splice(0);
    pendingDeltaBytesRef.current = 0;
    if (chunks.length === 0) {
      return;
    }

    const generation = generationRef.current;
    try {
      const pcmBytes = mergeBase64Uint8ArrayChunks(chunks);
      if (pcmBytes.byteLength === 0) {
        if (queuedFilesRef.current.length === 0 && !playerRef.current) {
          setIsPlaying(false);
          notifyIdle();
        }
        return;
      }

      const wavBytes = pcm16BytesToWavBytes(pcmBytes, {
        sampleRate: REALTIME_OUTPUT_SAMPLE_RATE,
        channels: 1,
      });
      const nextSequence = sequenceRef.current + 1;
      sequenceRef.current = nextSequence;
      const fileUri = `${cacheDirectory}realtime-voice-${Date.now()}-${nextSequence}.wav`;
      await writeBytesAsync(fileUri, wavBytes);
      if (generation !== generationRef.current) {
        void deleteAsync(fileUri, { idempotent: true });
        return;
      }

      queuedFilesRef.current.push(fileUri);
      setIsPlaying(true);
      await playNextRef.current();
    } catch (error) {
      logger.warn('Failed to prepare realtime speech chunk', { error });
      if (queuedFilesRef.current.length === 0 && !playerRef.current) {
        setIsPlaying(false);
        playbackModeReadyRef.current = false;
        notifyIdle();
      }
    }
  }, [notifyIdle]);

  const enqueuePcmDelta = useCallback(
    (base64Pcm: string) => {
      pendingDeltasRef.current.push(base64Pcm);
      pendingDeltaBytesRef.current += getBase64DecodedByteLength(base64Pcm);
      setIsPlaying(true);
      if (pendingDeltaBytesRef.current >= MIN_FLUSH_PCM_BYTES) {
        if (flushTimerRef.current) {
          clearTimer(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        void flushPendingDeltas();
        return;
      }

      if (flushTimerRef.current) {
        return;
      }

      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        void flushPendingDeltas();
      }, FLUSH_DELAY_MS);
    },
    [flushPendingDeltas]
  );

  const stopPlayback = useCallback(() => {
    const hadPlaybackWork =
      Boolean(flushTimerRef.current) ||
      pendingDeltasRef.current.length > 0 ||
      queuedFilesRef.current.length > 0 ||
      Boolean(playerRef.current) ||
      isStartingPlaybackRef.current;

    generationRef.current += 1;
    if (flushTimerRef.current) {
      clearTimer(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDeltasRef.current = [];
    pendingDeltaBytesRef.current = 0;
    playbackModeReadyRef.current = false;

    const queuedFiles = queuedFilesRef.current.splice(0);
    for (const fileUri of queuedFiles) {
      void deleteAsync(fileUri, { idempotent: true }).catch((error) => {
        logger.warn('Failed to remove queued realtime speech chunk', { error });
      });
    }

    clearCurrentPlayer();
    setIsPlaying(false);
    if (hadPlaybackWork) {
      notifyIdle();
    }
  }, [clearCurrentPlayer, notifyIdle]);

  useEffect(() => stopPlayback, [stopPlayback]);

  return {
    enqueuePcmDelta,
    flushPcmDeltas: flushPendingDeltas,
    isPlaying,
    stopPlayback,
  };
}
