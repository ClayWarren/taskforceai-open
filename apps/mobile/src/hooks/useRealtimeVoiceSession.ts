import {
  applyRealtimeVoiceTranscriptEvent,
  arrayBufferToBase64,
  buildRealtimeVoiceSessionConfig,
  fetchRealtimeVoiceSetup,
  getBase64DecodedByteLength,
  getGatewayRealtimeProtocols,
  mergeBase64Uint8ArrayChunks,
  normalizeRealtimeAudioBufferToBase64,
  pcm16BytesToWavBytes,
  parseRealtimeVoiceServerEvent,
  REALTIME_INPUT_SAMPLE_RATE,
  RealtimeVoiceAudioQueue,
  RealtimeVoiceSetupPrefetchCache,
  RealtimeVoiceTranscriptController,
  serializeRealtimeVoiceEvent,
  transcribeDictationAudio,
  type RealtimeVoiceClientEvent,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceServerEvent,
  type RealtimeVoiceSessionConfig,
  type RealtimeVoiceSetupResponse,
  type VoiceGatewayRequestOptions,
} from '@taskforceai/client-runtime';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamEncoding,
  type AudioStreamBuffer,
} from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { createModuleLogger } from '../logger';
import { createMobileVoiceGatewayRequestOptions } from '../voice/voiceGatewayClient';

import { useRealtimeAudioPlayback } from './useRealtimeAudioPlayback';

const logger = createModuleLogger('useRealtimeVoiceSession');
export type { RealtimeVoiceTranscriptMessage } from '@taskforceai/client-runtime';

const WEBSOCKET_OPEN = 1;
const REALTIME_READY_TIMEOUT_MS = 12_000;
const MAX_PENDING_AUDIO_CHUNKS = 160;
const REALTIME_CAPTURE_SAMPLE_RATE = REALTIME_INPUT_SAMPLE_RATE;
const REALTIME_CAPTURE_ENCODING: AudioStreamEncoding = 'float32';
const ACTIVE_USER_TRANSCRIPT_ID = 'user-active';
const PCM16_MAX_ABSOLUTE_VALUE = 32768;
const LOCAL_AUDIO_ACTIVITY_RMS_FLOOR = 0.0008;
const LOCAL_VOICE_ACTIVITY_RMS_THRESHOLD = 0.0025;
const LOCAL_VOICE_ACTIVITY_START_MS = 120;
const LOCAL_VOICE_ACTIVITY_END_SILENCE_MS = 850;
const LOCAL_VOICE_ACTIVITY_MIN_COMMIT_MS = 300;
const LOCAL_VOICE_ACTIVITY_MAX_COMMIT_MS = 6_000;
const LOCAL_AUDIO_ACTIVITY_FALLBACK_COMMIT_MS = 2_400;
const FALLBACK_TRANSCRIPTION_BIND_DELAY_MS = 1_200;
const MAX_FALLBACK_TRANSCRIPTION_PCM_BYTES = REALTIME_INPUT_SAMPLE_RATE * 2 * 10;

export type MobileRealtimeVoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const toRealtimeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Realtime voice is unavailable. Please try again.';

const prefetchedMobileRealtimeSetupCache =
  new RealtimeVoiceSetupPrefetchCache<RealtimeVoiceSetupResponse>();
let mobileRealtimeSetupPrefetchPromise: Promise<void> | null = null;

const getMobileRealtimeSetupCacheKey = (
  sessionConfig: RealtimeVoiceSessionConfig,
  options: VoiceGatewayRequestOptions
): string => {
  const headers = new Headers(options.headers);
  return [
    options.baseUrl ?? '',
    headers.get('authorization') ?? '',
    JSON.stringify(sessionConfig),
  ].join('\u001f');
};

const prewarmMobileRealtimeVoiceSetup = (sessionConfig: RealtimeVoiceSessionConfig): void => {
  if (mobileRealtimeSetupPrefetchPromise) {
    return;
  }

  mobileRealtimeSetupPrefetchPromise = (async () => {
    const options = await createMobileVoiceGatewayRequestOptions();
    const key = getMobileRealtimeSetupCacheKey(sessionConfig, options);
    if (prefetchedMobileRealtimeSetupCache.hasFresh(key)) {
      return;
    }

    const setup = await fetchRealtimeVoiceSetup({
      ...options,
      sessionConfig,
    });
    prefetchedMobileRealtimeSetupCache.store(key, setup);
  })()
    .catch((error) => {
      logger.debug('Realtime voice setup prewarm failed', { error });
    })
    .finally(() => {
      mobileRealtimeSetupPrefetchPromise = null;
    });
};

const consumePrefetchedMobileRealtimeSetup = async (
  sessionConfig: RealtimeVoiceSessionConfig,
  options: VoiceGatewayRequestOptions
): Promise<RealtimeVoiceSetupResponse | null> => {
  if (mobileRealtimeSetupPrefetchPromise) {
    await mobileRealtimeSetupPrefetchPromise.catch(() => undefined);
  }

  const key = getMobileRealtimeSetupCacheKey(sessionConfig, options);
  return prefetchedMobileRealtimeSetupCache.consume(key);
};

const fetchMobileRealtimeVoiceSetup = async ({
  sessionConfig,
  signal,
}: {
  sessionConfig: RealtimeVoiceSessionConfig;
  signal: AbortSignal;
}): Promise<RealtimeVoiceSetupResponse> => {
  const options = await createMobileVoiceGatewayRequestOptions();
  const prefetchedSetup = await consumePrefetchedMobileRealtimeSetup(sessionConfig, options);
  if (prefetchedSetup) {
    return prefetchedSetup;
  }

  return fetchRealtimeVoiceSetup({
    ...options,
    sessionConfig,
    signal,
  });
};

const getBytesPerSample = (encoding: AudioStreamEncoding): number =>
  encoding === 'float32' ? Float32Array.BYTES_PER_ELEMENT : Int16Array.BYTES_PER_ELEMENT;

const estimateAudioDurationMs = (
  buffer: AudioStreamBuffer,
  encoding: AudioStreamEncoding
): number => {
  const sampleRate = Math.max(1, buffer.sampleRate);
  const channels = Math.max(1, buffer.channels);
  const sampleCount = Math.floor(buffer.data.byteLength / getBytesPerSample(encoding));
  const frameCount = Math.max(0, Math.floor(sampleCount / channels));
  return (frameCount / sampleRate) * 1000;
};

const calculatePcmRmsLevel = (
  data: ArrayBuffer | ArrayBufferView,
  encoding: AudioStreamEncoding
): number => {
  const view = ArrayBuffer.isView(data)
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
  const bytesPerSample = getBytesPerSample(encoding);
  const sampleCount = Math.floor(view.byteLength / bytesPerSample);
  if (sampleCount === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const normalized =
      encoding === 'float32'
        ? view.getFloat32(index * bytesPerSample, true)
        : view.getInt16(index * bytesPerSample, true) / PCM16_MAX_ABSOLUTE_VALUE;
    total += normalized * normalized;
  }
  return Math.sqrt(total / sampleCount);
};

type PendingFallbackTranscription = {
  chunks: string[];
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
};

export function useRealtimeVoiceSession() {
  const playbackIdleHandlerRef = useRef<() => void>(() => {});
  const { enqueuePcmDelta, flushPcmDeltas, isPlaying, stopPlayback } = useRealtimeAudioPlayback({
    onIdle: () => playbackIdleHandlerRef.current(),
  });
  const [status, setStatus] = useState<MobileRealtimeVoiceStatus>('disconnected');
  const [messages, setMessages] = useState<RealtimeVoiceTranscriptMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [endedDurationMs, setEndedDurationMs] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketCleanupRef = useRef<(() => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isDisconnectingRef = useRef(false);
  const transcriptControllerRef = useRef(
    new RealtimeVoiceTranscriptController(ACTIVE_USER_TRANSCRIPT_ID)
  );
  const audioQueueRef = useRef(new RealtimeVoiceAudioQueue(MAX_PENDING_AUDIO_CHUNKS));
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedSampleRateRef = useRef(false);
  const voiceCandidateDurationMsRef = useRef(0);
  const activeVoiceDurationMsRef = useRef(0);
  const activeSilenceDurationMsRef = useRef(0);
  const audioActivityFallbackDurationMsRef = useRef(0);
  const hasUncommittedVoiceRef = useRef(false);
  const serverVoiceActivityRef = useRef(false);
  const realtimeSessionReadyRef = useRef(false);
  const statusRef = useRef<MobileRealtimeVoiceStatus>('disconnected');
  const isPlayingRef = useRef(false);
  const capturePausedForPlaybackRef = useRef(false);
  const pendingCaptureResumeRef = useRef(false);
  const assistantAudioPendingRef = useRef(false);
  const currentTurnAudioBytesRef = useRef(0);
  const currentTurnAudioChunksRef = useRef<string[]>([]);
  const fallbackTranscriptionGenerationRef = useRef(0);
  const fallbackTranscriptionSequenceRef = useRef(0);
  const pendingFallbackTranscriptionRef = useRef<PendingFallbackTranscription | null>(null);
  const providerTranscribedItemIdsRef = useRef(new Set<string>());
  const disconnectRef = useRef<(recordEnded?: boolean) => void>(() => {});

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const clearReadyTimeout = useCallback(() => {
    if (!readyTimeoutRef.current) {
      return;
    }
    clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = null;
  }, []);

  const sendOrQueueAudio = useCallback((audio: string) => {
    if (!audio) {
      return;
    }

    const socket = socketRef.current;
    if (socket && socket.readyState === WEBSOCKET_OPEN && realtimeSessionReadyRef.current) {
      socket.send(serializeRealtimeVoiceEvent({ type: 'input-audio-append', audio }));
      return;
    }

    audioQueueRef.current.pushAudio(audio);
  }, []);

  const sendOrQueueTurnCommit = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WEBSOCKET_OPEN || !realtimeSessionReadyRef.current) {
      audioQueueRef.current.requestTurnCommit();
      return;
    }

    socket.send(serializeRealtimeVoiceEvent({ type: 'input-audio-commit' }));
    socket.send(serializeRealtimeVoiceEvent({ type: 'response-create' }));
  }, []);

  const flushPendingAudio = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WEBSOCKET_OPEN || !realtimeSessionReadyRef.current) {
      return;
    }

    audioQueueRef.current.flush({
      sendAudio: (audio) => {
        socket.send(serializeRealtimeVoiceEvent({ type: 'input-audio-append', audio }));
      },
      commitTurn: () => {
        socket.send(serializeRealtimeVoiceEvent({ type: 'input-audio-commit' }));
        socket.send(serializeRealtimeVoiceEvent({ type: 'response-create' }));
      },
    });
  }, []);

  const clearCurrentTurnAudio = useCallback(() => {
    currentTurnAudioBytesRef.current = 0;
    currentTurnAudioChunksRef.current = [];
  }, []);

  const rememberCurrentTurnAudio = useCallback((audio: string) => {
    const byteLength = getBase64DecodedByteLength(audio);
    if (
      byteLength <= 0 ||
      currentTurnAudioBytesRef.current >= MAX_FALLBACK_TRANSCRIPTION_PCM_BYTES
    ) {
      return;
    }

    currentTurnAudioChunksRef.current.push(audio);
    currentTurnAudioBytesRef.current += byteLength;
  }, []);

  const takeCurrentTurnAudio = useCallback((): string[] => {
    const chunks = currentTurnAudioChunksRef.current;
    clearCurrentTurnAudio();
    return chunks;
  }, [clearCurrentTurnAudio]);

  const cancelPendingFallbackTranscription = useCallback(() => {
    const pending = pendingFallbackTranscriptionRef.current;
    if (pending) {
      clearTimeout(pending.timeout);
      pendingFallbackTranscriptionRef.current = null;
    }
  }, []);

  const applyFallbackUserTranscript = useCallback((itemId: string, transcript: string) => {
    if (!transcript.trim() || providerTranscribedItemIdsRef.current.has(itemId)) {
      return;
    }

    setMessages(
      transcriptControllerRef.current.addUserTranscript({
        itemId,
        transcript,
        finalMessageMetadata: {
          isStreaming: false,
          isEphemeral: false,
        },
      })
    );
  }, []);

  const startFallbackTranscription = useCallback(
    (itemId: string, chunks: string[], generation: number) => {
      if (chunks.length === 0 || providerTranscribedItemIdsRef.current.has(itemId)) {
        return;
      }

      void (async () => {
        const pcmBytes = mergeBase64Uint8ArrayChunks(chunks);
        if (pcmBytes.byteLength === 0) {
          return;
        }

        const wavBytes = pcm16BytesToWavBytes(pcmBytes, {
          sampleRate: REALTIME_INPUT_SAMPLE_RATE,
          channels: 1,
        });
        const options = await createMobileVoiceGatewayRequestOptions();
        const transcript = await transcribeDictationAudio(
          {
            data: arrayBufferToBase64(wavBytes),
            filename: 'realtime-voice.wav',
            format: 'wav',
            mediaType: 'audio/wav',
            mimeType: 'audio/wav',
          },
          options
        );

        if (fallbackTranscriptionGenerationRef.current !== generation) {
          return;
        }
        applyFallbackUserTranscript(itemId, transcript);
      })().catch((error: unknown) => {
        logger.warn('Realtime voice fallback transcription failed', { error });
      });
    },
    [applyFallbackUserTranscript]
  );

  const queueFallbackTranscription = useCallback(
    (itemId: string | undefined, chunks: string[]) => {
      cancelPendingFallbackTranscription();
      if (chunks.length === 0) {
        return;
      }

      const generation = fallbackTranscriptionGenerationRef.current;
      if (itemId) {
        startFallbackTranscription(itemId, chunks, generation);
        return;
      }

      fallbackTranscriptionSequenceRef.current += 1;
      const localItemId = `local-${fallbackTranscriptionSequenceRef.current}`;
      const timeout = setTimeout(() => {
        pendingFallbackTranscriptionRef.current = null;
        startFallbackTranscription(localItemId, chunks, generation);
      }, FALLBACK_TRANSCRIPTION_BIND_DELAY_MS);
      pendingFallbackTranscriptionRef.current = {
        chunks,
        generation,
        timeout,
      };
    },
    [cancelPendingFallbackTranscription, startFallbackTranscription]
  );

  const bindPendingFallbackTranscription = useCallback(
    (itemId: string) => {
      const pending = pendingFallbackTranscriptionRef.current;
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pendingFallbackTranscriptionRef.current = null;
      startFallbackTranscription(itemId, pending.chunks, pending.generation);
    },
    [startFallbackTranscription]
  );

  const setActiveUserTranscript = useCallback((itemId: string | undefined, text = '') => {
    setMessages(
      transcriptControllerRef.current.setActiveUserTranscript({
        itemId,
        text,
        isStreaming: true,
        isEphemeral: true,
      })
    );
  }, []);

  const resetLocalVoiceActivity = useCallback(() => {
    audioQueueRef.current.clearTurnCommit();
    clearCurrentTurnAudio();
    voiceCandidateDurationMsRef.current = 0;
    activeVoiceDurationMsRef.current = 0;
    activeSilenceDurationMsRef.current = 0;
    audioActivityFallbackDurationMsRef.current = 0;
    hasUncommittedVoiceRef.current = false;
  }, [clearCurrentTurnAudio]);

  const commitLocalVoiceTurn = useCallback((itemId?: string) => {
    if (
      !hasUncommittedVoiceRef.current ||
      activeVoiceDurationMsRef.current < LOCAL_VOICE_ACTIVITY_MIN_COMMIT_MS
    ) {
      return;
    }

    setActiveUserTranscript(itemId);
    queueFallbackTranscription(itemId, takeCurrentTurnAudio());
    hasUncommittedVoiceRef.current = false;
    voiceCandidateDurationMsRef.current = 0;
    activeVoiceDurationMsRef.current = 0;
    activeSilenceDurationMsRef.current = 0;
    sendOrQueueTurnCommit();
  }, [queueFallbackTranscription, sendOrQueueTurnCommit, setActiveUserTranscript, takeCurrentTurnAudio]);

  const noteLocalVoiceActivity = useCallback(
    (buffer: AudioStreamBuffer, audio: string) => {
      const durationMs = estimateAudioDurationMs(buffer, REALTIME_CAPTURE_ENCODING);
      const rmsLevel = calculatePcmRmsLevel(buffer.data, REALTIME_CAPTURE_ENCODING);
      const hasVoice = rmsLevel >= LOCAL_VOICE_ACTIVITY_RMS_THRESHOLD;

      if (hasVoice) {
        rememberCurrentTurnAudio(audio);
        activeSilenceDurationMsRef.current = 0;
        voiceCandidateDurationMsRef.current += durationMs;

        if (!hasUncommittedVoiceRef.current) {
          if (voiceCandidateDurationMsRef.current >= LOCAL_VOICE_ACTIVITY_START_MS) {
            stopPlayback();
            setActiveUserTranscript(undefined);
            hasUncommittedVoiceRef.current = true;
            activeVoiceDurationMsRef.current = voiceCandidateDurationMsRef.current;
          }
          return;
        }

        activeVoiceDurationMsRef.current += durationMs;
        audioActivityFallbackDurationMsRef.current = 0;
        if (activeVoiceDurationMsRef.current >= LOCAL_VOICE_ACTIVITY_MAX_COMMIT_MS) {
          commitLocalVoiceTurn();
        }
        return;
      }

      if (
        rmsLevel >= LOCAL_AUDIO_ACTIVITY_RMS_FLOOR &&
        !serverVoiceActivityRef.current &&
        statusRef.current === 'connected'
      ) {
        rememberCurrentTurnAudio(audio);
        audioActivityFallbackDurationMsRef.current += durationMs;
        if (
          audioActivityFallbackDurationMsRef.current >= LOCAL_AUDIO_ACTIVITY_FALLBACK_COMMIT_MS
        ) {
          stopPlayback();
          hasUncommittedVoiceRef.current = true;
          activeVoiceDurationMsRef.current = LOCAL_VOICE_ACTIVITY_MIN_COMMIT_MS;
          audioActivityFallbackDurationMsRef.current = 0;
          commitLocalVoiceTurn();
        }
        return;
      }

      if (!hasUncommittedVoiceRef.current) {
        voiceCandidateDurationMsRef.current = 0;
        audioActivityFallbackDurationMsRef.current = 0;
        clearCurrentTurnAudio();
        return;
      }

      rememberCurrentTurnAudio(audio);
      activeSilenceDurationMsRef.current += durationMs;
      if (activeSilenceDurationMsRef.current >= LOCAL_VOICE_ACTIVITY_END_SILENCE_MS) {
        commitLocalVoiceTurn();
      }
    },
    [clearCurrentTurnAudio, commitLocalVoiceTurn, rememberCurrentTurnAudio, setActiveUserTranscript, stopPlayback]
  );

  const handleAudioBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (buffer.sampleRate !== REALTIME_CAPTURE_SAMPLE_RATE && !warnedSampleRateRef.current) {
      warnedSampleRateRef.current = true;
      logger.warn('Realtime voice microphone sample rate differed from requested rate', {
        actualSampleRate: buffer.sampleRate,
        requestedSampleRate: REALTIME_CAPTURE_SAMPLE_RATE,
      });
    }

    const audio = normalizeRealtimeAudioBufferToBase64(buffer.data, {
        inputEncoding: REALTIME_CAPTURE_ENCODING === 'float32' ? 'float32' : 'pcm16',
        inputChannels: buffer.channels,
        inputSampleRate: buffer.sampleRate,
        outputSampleRate: REALTIME_INPUT_SAMPLE_RATE,
      });
    sendOrQueueAudio(audio);
    noteLocalVoiceActivity(buffer, audio);
  }, [noteLocalVoiceActivity, sendOrQueueAudio]);

  const { stream, isStreaming } = useAudioStream({
    sampleRate: REALTIME_CAPTURE_SAMPLE_RATE,
    channels: 1,
    encoding: REALTIME_CAPTURE_ENCODING,
    onBuffer: handleAudioBuffer,
  });

  const configureRecordingAudioMode = useCallback(
    () =>
      setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      }),
    []
  );

  const configurePlaybackAudioMode = useCallback(
    () =>
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      }),
    []
  );

  const pauseCaptureForAssistantPlayback = useCallback(() => {
    if (capturePausedForPlaybackRef.current) {
      return;
    }

    capturePausedForPlaybackRef.current = true;
    try {
      stream.stop();
    } catch (error) {
      logger.warn('Failed to pause realtime microphone stream for playback', { error });
    }

    void configurePlaybackAudioMode().catch((error: unknown) => {
      logger.warn('Failed to configure realtime playback audio mode', { error });
    });
  }, [configurePlaybackAudioMode, stream]);

  const resumeCaptureAfterAssistantPlayback = useCallback(() => {
    if (
      !pendingCaptureResumeRef.current ||
      isPlayingRef.current ||
      assistantAudioPendingRef.current
    ) {
      return;
    }
    pendingCaptureResumeRef.current = false;

    if (!capturePausedForPlaybackRef.current || statusRef.current !== 'connected') {
      capturePausedForPlaybackRef.current = false;
      return;
    }

    void (async () => {
      await configureRecordingAudioMode();
      await stream.start();
      capturePausedForPlaybackRef.current = false;
    })().catch((error: unknown) => {
      capturePausedForPlaybackRef.current = false;
      logger.error('Failed to resume realtime microphone stream after playback', { error });
      setErrorMessage(toRealtimeErrorMessage(error));
      disconnectRef.current(false);
      setStatus('error');
    });
  }, [configureRecordingAudioMode, stream]);

  useEffect(() => {
    playbackIdleHandlerRef.current = () => {
      assistantAudioPendingRef.current = false;
      resumeCaptureAfterAssistantPlayback();
    };
  }, [resumeCaptureAfterAssistantPlayback]);

  useEffect(() => {
    resumeCaptureAfterAssistantPlayback();
  }, [isPlaying, resumeCaptureAfterAssistantPlayback]);

  const sendEvent = useCallback((event: RealtimeVoiceClientEvent) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WEBSOCKET_OPEN) {
      return;
    }
    socket.send(serializeRealtimeVoiceEvent(event));
  }, []);

  const clearActiveUserTranscript = useCallback(() => {
    setMessages(transcriptControllerRef.current.clearActiveUserTranscript());
  }, []);

  const applyTranscriptEvent = useCallback((event: RealtimeVoiceServerEvent) => {
    const nextMessages = applyRealtimeVoiceTranscriptEvent(
      transcriptControllerRef.current,
      event,
      {
        finalUserMessageMetadata: {
          isStreaming: false,
          isEphemeral: false,
        },
      }
    );
    if (nextMessages) {
      setMessages(nextMessages);
    }
  }, []);

  const handleServerEvent = useCallback(
    (event: RealtimeVoiceServerEvent) => {
      switch (event.type) {
        case 'session-created':
        case 'session-updated':
          realtimeSessionReadyRef.current = true;
          statusRef.current = 'connected';
          setStatus('connected');
          clearReadyTimeout();
          abortControllerRef.current = null;
          flushPendingAudio();
          return;
        case 'speech-started':
          serverVoiceActivityRef.current = true;
          resetLocalVoiceActivity();
          stopPlayback();
          hasUncommittedVoiceRef.current = true;
          activeVoiceDurationMsRef.current = LOCAL_VOICE_ACTIVITY_MIN_COMMIT_MS;
          applyTranscriptEvent(event);
          return;
        case 'speech-stopped':
          applyTranscriptEvent(event);
          commitLocalVoiceTurn(typeof event.itemId === 'string' ? event.itemId : undefined);
          serverVoiceActivityRef.current = false;
          return;
        case 'audio-committed':
          if (typeof event.itemId === 'string') {
            bindPendingFallbackTranscription(event.itemId);
          }
          resetLocalVoiceActivity();
          serverVoiceActivityRef.current = false;
          if (typeof event.itemId === 'string') {
            setActiveUserTranscript(event.itemId);
          }
          return;
        case 'response-created':
          pauseCaptureForAssistantPlayback();
          return;
        case 'audio-delta':
          if (typeof event.delta === 'string') {
            assistantAudioPendingRef.current = true;
            pauseCaptureForAssistantPlayback();
            enqueuePcmDelta(event.delta);
          }
          return;
        case 'audio-done':
        case 'response-done':
          void flushPcmDeltas();
          pendingCaptureResumeRef.current = true;
          serverVoiceActivityRef.current = false;
          resumeCaptureAfterAssistantPlayback();
          return;
        case 'input-transcription-completed':
          cancelPendingFallbackTranscription();
          if (typeof event.itemId === 'string') {
            providerTranscribedItemIdsRef.current.add(event.itemId);
          }
          applyTranscriptEvent(event);
          serverVoiceActivityRef.current = false;
          return;
        case 'audio-transcript-delta':
        case 'text-delta':
          applyTranscriptEvent(event);
          return;
        case 'audio-transcript-done':
          applyTranscriptEvent(event);
          return;
        case 'text-done':
          applyTranscriptEvent(event);
          return;
        case 'error': {
          const message = typeof event.message === 'string' ? event.message : 'Realtime voice failed.';
          logger.error('Realtime voice server error', { error: message });
          disconnectRef.current(false);
          setErrorMessage(message);
          statusRef.current = 'error';
          setStatus('error');
          return;
        }
        default:
          return;
      }
    },
    [
      applyTranscriptEvent,
      clearReadyTimeout,
      commitLocalVoiceTurn,
      enqueuePcmDelta,
      flushPcmDeltas,
      bindPendingFallbackTranscription,
      cancelPendingFallbackTranscription,
      flushPendingAudio,
      pauseCaptureForAssistantPlayback,
      resetLocalVoiceActivity,
      resumeCaptureAfterAssistantPlayback,
      setActiveUserTranscript,
      stopPlayback,
    ]
  );

  const recordEndedDuration = useCallback((recordEnded: boolean) => {
    if (!recordEnded || startedAtRef.current === null) {
      startedAtRef.current = null;
      return;
    }
    setEndedDurationMs(Date.now() - startedAtRef.current);
    startedAtRef.current = null;
  }, []);

  const disconnect = useCallback(
    (recordEnded = true) => {
      isDisconnectingRef.current = true;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      clearReadyTimeout();
      audioQueueRef.current.clear();
      pendingCaptureResumeRef.current = false;
      capturePausedForPlaybackRef.current = false;
      assistantAudioPendingRef.current = false;
      serverVoiceActivityRef.current = false;
      realtimeSessionReadyRef.current = false;
      fallbackTranscriptionGenerationRef.current += 1;
      cancelPendingFallbackTranscription();
      providerTranscribedItemIdsRef.current.clear();
      resetLocalVoiceActivity();
      clearActiveUserTranscript();

      try {
        stream.stop();
      } catch (error) {
        logger.warn('Failed to stop realtime microphone stream', { error });
      }

      const socket = socketRef.current;
      socketRef.current = null;
      socketCleanupRef.current?.();
      socketCleanupRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch (error) {
          logger.warn('Failed to close realtime voice socket', { error });
        }
      }

      stopPlayback();
      statusRef.current = 'disconnected';
      setStatus('disconnected');
      recordEndedDuration(recordEnded);
      isDisconnectingRef.current = false;
    },
    [
      cancelPendingFallbackTranscription,
      clearActiveUserTranscript,
      clearReadyTimeout,
      recordEndedDuration,
      resetLocalVoiceActivity,
      stopPlayback,
      stream,
    ]
  );

  disconnectRef.current = disconnect;

  const prewarm = useCallback(() => {
    prewarmMobileRealtimeVoiceSetup(buildRealtimeVoiceSessionConfig());
  }, []);

  const connect = useCallback(async () => {
    if (status === 'connecting' || status === 'connected') {
      disconnect();
      return;
    }

    if (typeof WebSocket === 'undefined') {
      const message = 'Realtime voice is unavailable on this device.';
      setErrorMessage(message);
      Alert.alert('Realtime Voice', message);
      return;
    }

    clearReadyTimeout();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    statusRef.current = 'connecting';
    setStatus('connecting');
    setErrorMessage(null);
    setEndedDurationMs(null);
    setMessages(transcriptControllerRef.current.reset());
    audioQueueRef.current.clear();
    pendingCaptureResumeRef.current = false;
    capturePausedForPlaybackRef.current = false;
    assistantAudioPendingRef.current = false;
    warnedSampleRateRef.current = false;
    serverVoiceActivityRef.current = false;
    realtimeSessionReadyRef.current = false;
    fallbackTranscriptionGenerationRef.current += 1;
    cancelPendingFallbackTranscription();
    providerTranscribedItemIdsRef.current.clear();
    resetLocalVoiceActivity();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    clearReadyTimeout();
    readyTimeoutRef.current = setTimeout(() => {
      if (abortControllerRef.current !== abortController || abortController.signal.aborted) {
        return;
      }
      const message = 'Realtime voice took too long to connect. Please try again.';
      logger.error('Realtime voice connection timed out', { status });
      setErrorMessage(message);
      disconnect(false);
      statusRef.current = 'error';
      setStatus('error');
    }, REALTIME_READY_TIMEOUT_MS);

    try {
      const sessionConfig = buildRealtimeVoiceSessionConfig();
      const setupPromise = fetchMobileRealtimeVoiceSetup({
        sessionConfig,
        signal: abortController.signal,
      });
      setupPromise.catch(() => undefined);

      const permissions = await requestRecordingPermissionsAsync();
      if (!permissions.granted) {
        throw new Error('Microphone access is required for realtime voice.');
      }

      await configureRecordingAudioMode();

      void stream.start().catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }
        logger.error('Failed to start realtime microphone stream', { error });
        setErrorMessage(toRealtimeErrorMessage(error));
        disconnect(false);
        statusRef.current = 'error';
        setStatus('error');
      });

      const setup = await setupPromise;

      if (abortController.signal.aborted) {
        return;
      }

      const socket = new WebSocket(setup.url, getGatewayRealtimeProtocols(setup.token));
      socketRef.current = socket;
      startedAtRef.current = Date.now();

      const handleOpen = () => {
        if (socketRef.current !== socket) {
          return;
        }

        sendEvent({
          type: 'session-update',
          config: {
            ...sessionConfig,
            tools: setup.tools ?? [],
          },
        });
      };

      const handleMessage = (event: MessageEvent) => {
        void parseRealtimeVoiceServerEvent(event.data).then((serverEvent) => {
          if (socketRef.current !== socket) {
            return;
          }
          if (serverEvent) {
            handleServerEvent(serverEvent);
          }
        });
      };

      const handleError = (event: Event) => {
        logger.error('Realtime voice socket failed', { error: event });
        const message = 'Realtime voice connection failed.';
        disconnect(false);
        setErrorMessage(message);
        statusRef.current = 'error';
        setStatus('error');
      };

      const handleClose = () => {
        clearReadyTimeout();
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        if (socketRef.current === socket) {
          socketRef.current = null;
          socketCleanupRef.current?.();
          socketCleanupRef.current = null;
        }
        pendingCaptureResumeRef.current = false;
        capturePausedForPlaybackRef.current = false;
        assistantAudioPendingRef.current = false;
        realtimeSessionReadyRef.current = false;
        try {
          stream.stop();
        } catch (error) {
          logger.warn('Failed to stop realtime microphone stream after socket close', { error });
        }
        stopPlayback();
        recordEndedDuration(true);
        if (!isDisconnectingRef.current && statusRef.current !== 'error') {
          statusRef.current = 'disconnected';
        }
        setStatus((currentStatus) =>
          currentStatus === 'error' || isDisconnectingRef.current ? currentStatus : 'disconnected'
        );
      };

      socket.addEventListener('open', handleOpen);
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('error', handleError);
      socket.addEventListener('close', handleClose);
      socketCleanupRef.current = () => {
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('message', handleMessage);
        socket.removeEventListener('error', handleError);
        socket.removeEventListener('close', handleClose);
      };
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      clearReadyTimeout();
      const message = toRealtimeErrorMessage(error);
      logger.error('Realtime voice session failed', { error });
      disconnect(false);
      setErrorMessage(message);
      statusRef.current = 'error';
      setStatus('error');
      Alert.alert('Realtime Voice', message);
    }
  }, [
    clearReadyTimeout,
    configureRecordingAudioMode,
    cancelPendingFallbackTranscription,
    disconnect,
    flushPendingAudio,
    handleServerEvent,
    recordEndedDuration,
    resetLocalVoiceActivity,
    sendEvent,
    status,
    stopPlayback,
    stream,
  ]);

  useEffect(() => () => disconnect(false), [disconnect]);

  const resetSession = useCallback(() => {
    disconnect(false);
    setEndedDurationMs(null);
    setErrorMessage(null);
    setMessages(transcriptControllerRef.current.reset());
    audioQueueRef.current.clear();
    pendingCaptureResumeRef.current = false;
    capturePausedForPlaybackRef.current = false;
    assistantAudioPendingRef.current = false;
    serverVoiceActivityRef.current = false;
    realtimeSessionReadyRef.current = false;
    fallbackTranscriptionGenerationRef.current += 1;
    cancelPendingFallbackTranscription();
    providerTranscribedItemIdsRef.current.clear();
    resetLocalVoiceActivity();
  }, [cancelPendingFallbackTranscription, disconnect, resetLocalVoiceActivity]);

  const isActive = status === 'connecting' || status === 'connected';
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.text.trim().length > 0),
    [messages]
  );

  return {
    connect,
    disconnect,
    endedDurationMs,
    errorMessage,
    isActive,
    isCapturing: isStreaming && (status === 'connecting' || status === 'connected'),
    isPlaying,
    messages: visibleMessages,
    prewarm,
    resetSession,
    status,
  };
}
