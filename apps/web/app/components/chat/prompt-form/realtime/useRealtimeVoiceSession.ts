import { experimental_useRealtime, type Experimental_UseRealtimeOptions } from '@ai-sdk/react';
import { gateway } from '@ai-sdk/gateway';
import {
  applyRealtimeVoiceTranscriptEvent,
  buildRealtimeVoiceSessionConfig,
  DEFAULT_REALTIME_VOICE_INSTRUCTIONS,
  getRealtimeTranscriptMessagesSignature,
  REALTIME_SETUP_ENDPOINT,
  REALTIME_VOICE_MODEL_ID,
  RealtimeVoiceAudioQueue,
  RealtimeVoiceTranscriptController,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceSessionConfig,
  type RealtimeVoiceServerEvent,
} from '@taskforceai/client-runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../../../lib/logger';
import { usePlatformRuntime } from '../../../../lib/platform/PlatformProvider';
import { RealtimeBrowserMicrophone } from './realtimeBrowserAudio';
import {
  connectRealtimeWithCsrf,
  getRealtimeSetupRequestBody,
  prewarmRealtimeVoiceSetup,
  warmRealtimeVoiceSetup,
} from '../../../../lib/api/realtime-voice';
import { useDesktopRealtimeVoiceSession } from '../../../../lib/platform/desktop-ui';

export type { RealtimeVoiceTranscriptMessage } from '@taskforceai/client-runtime';
export {
  connectRealtimeWithCsrf,
  prewarmRealtimeVoiceSetup,
} from '../../../../lib/api/realtime-voice';

const formatRealtimeError = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message : 'Realtime voice is unavailable. Please try again.';

  if (message.includes('Failed to fetch realtime setup: 401')) {
    return 'Sign in to use realtime voice.';
  }
  if (message.includes('Failed to fetch realtime setup: 403')) {
    return 'Realtime voice is not enabled for this deployment.';
  }
  if (message.includes('Failed to fetch realtime setup: 503')) {
    return 'Realtime voice is not configured for this deployment.';
  }

  return message;
};

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

type RealtimeVoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type TextUIPartLike = { type: 'text'; text: string; state?: unknown };
type BrowserRealtimeSessionConfig = RealtimeVoiceSessionConfig &
  NonNullable<Experimental_UseRealtimeOptions['sessionConfig']>;

const ACTIVE_USER_TRANSCRIPT_ID = 'user-active-speech';
const QUEUED_REALTIME_AUDIO_CHUNKS = 96;
const REALTIME_READY_TIMEOUT_MS = 8_000;
const REALTIME_READY_TIMEOUT_MESSAGE = 'Realtime voice took too long to connect. Please try again.';

const getBrowserActiveTranscriptText = (event: RealtimeVoiceServerEvent): string =>
  event.type === 'speech-started' ? 'Listening...' : 'Transcribing...';

export const resolveRealtimeVoiceActivity = ({
  isCapturing = false,
  isConnectionStarting,
  realtimeStatus,
}: {
  isCapturing?: boolean;
  isConnectionStarting: boolean;
  realtimeStatus: RealtimeVoiceStatus;
}): { isActive: boolean; status: RealtimeVoiceStatus } => ({
  isActive:
    isConnectionStarting ||
    isCapturing ||
    realtimeStatus === 'connecting' ||
    realtimeStatus === 'connected',
  status:
    isCapturing && realtimeStatus === 'connecting'
      ? 'connected'
      : isConnectionStarting && realtimeStatus === 'disconnected'
        ? 'connecting'
        : realtimeStatus,
});

export function useRealtimeVoiceSession({
  onMessagesChange,
  setErrorMessage,
}: {
  onMessagesChange?: (messages: RealtimeVoiceTranscriptMessage[]) => void;
  setErrorMessage: (message: string) => void;
}) {
  const platformRuntime = usePlatformRuntime();
  const desktopRealtime = useDesktopRealtimeVoiceSession({ setErrorMessage });
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pendingCaptureStreamRef = useRef<MediaStream | null>(null);
  const browserMicrophoneRef = useRef<RealtimeBrowserMicrophone | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const realtimeStatusRef = useRef<RealtimeVoiceStatus>('disconnected');
  const audioQueueRef = useRef(new RealtimeVoiceAudioQueue(QUEUED_REALTIME_AUDIO_CHUNKS));
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptRef = useRef(0);
  const transcriptControllerRef = useRef(
    new RealtimeVoiceTranscriptController(ACTIVE_USER_TRANSCRIPT_ID)
  );
  const lastMessagesNotificationSignatureRef = useRef('');
  const [endedDurationMs, setEndedDurationMs] = useState<number | null>(null);
  const [isConnectionStarting, setIsConnectionStarting] = useState(false);
  const [isBrowserCapturing, setIsBrowserCapturing] = useState(false);
  const [messages, setMessages] = useState<RealtimeVoiceTranscriptMessage[]>([]);

  useEffect(() => {
    if (platformRuntime !== 'browser') {
      return;
    }
    warmRealtimeVoiceSetup();
  }, [platformRuntime]);

  const realtimeSessionConfig = useMemo(
    () =>
      buildRealtimeVoiceSessionConfig({
        instructions: DEFAULT_REALTIME_VOICE_INSTRUCTIONS,
        turnDetection: { type: 'server-vad' },
      }) as BrowserRealtimeSessionConfig,
    []
  );
  const realtimeModel = useMemo(() => gateway.experimental_realtime(REALTIME_VOICE_MODEL_ID), []);
  const realtimeApi = useMemo(() => ({ token: REALTIME_SETUP_ENDPOINT }), []);

  const handleRealtimeEvent = useCallback((event: RealtimeVoiceServerEvent) => {
    const nextMessages = applyRealtimeVoiceTranscriptEvent(transcriptControllerRef.current, event, {
      activeUserTranscript: {
        getText: getBrowserActiveTranscriptText,
        isStreaming: true,
        isEphemeral: true,
      },
    });
    if (nextMessages) {
      setMessages(nextMessages);
    }
  }, []);

  const realtime = experimental_useRealtime({
    model: realtimeModel,
    api: realtimeApi,
    sessionConfig: realtimeSessionConfig,
    onEvent: handleRealtimeEvent,
    onError: (error) => {
      logger.error('Realtime voice session failed', { error });
      setErrorMessage(formatRealtimeError(error));
    },
  });
  const realtimeRef = useRef(realtime);

  const clearReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current === null) {
      return;
    }

    clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = null;
  }, []);

  const flushPendingAudio = useCallback((session = realtimeRef.current) => {
    if (realtimeStatusRef.current !== 'connected') {
      return;
    }

    audioQueueRef.current.flush({ sendAudio: (audio) => session.sendAudio(audio) });
  }, []);

  useEffect(() => {
    realtimeRef.current = realtime;
    realtimeStatusRef.current = realtime.status;
    if (realtime.status === 'connected') {
      clearReadyTimeout();
      flushPendingAudio(realtime);
    }
  }, [clearReadyTimeout, flushPendingAudio, realtime, realtime.status]);

  const getBrowserMicrophone = useCallback(() => {
    browserMicrophoneRef.current ??= new RealtimeBrowserMicrophone();
    return browserMicrophoneRef.current;
  }, []);

  const stopBrowserAudioCapture = useCallback(() => {
    browserMicrophoneRef.current?.stop();
    setIsBrowserCapturing(false);
  }, []);

  const sendOrQueueRealtimeAudio = useCallback(
    (audio: string, session = realtimeRef.current) => {
      if (realtimeStatusRef.current === 'connected') {
        flushPendingAudio(session);
        session.sendAudio(audio);
        return;
      }

      audioQueueRef.current.pushAudio(audio);
    },
    [flushPendingAudio]
  );

  const startBrowserAudioCapture = useCallback(
    async (stream: MediaStream) => {
      await getBrowserMicrophone().start(stream, (audio) => {
        sendOrQueueRealtimeAudio(audio);
      });
      if (mediaStreamRef.current !== stream && pendingCaptureStreamRef.current !== stream) {
        getBrowserMicrophone().stop();
        return;
      }
      setIsBrowserCapturing(true);
    },
    [getBrowserMicrophone, sendOrQueueRealtimeAudio]
  );

  useEffect(() => {
    if (
      isConnectionStarting &&
      (realtime.status === 'connecting' ||
        realtime.status === 'connected' ||
        realtime.status === 'error')
    ) {
      setIsConnectionStarting(false);
    }
  }, [isConnectionStarting, realtime.status]);

  const { isActive, status } = resolveRealtimeVoiceActivity({
    isCapturing: isBrowserCapturing || realtime.isCapturing,
    isConnectionStarting,
    realtimeStatus: realtime.status,
  });

  const disconnect = useCallback(
    (recordEnded = true) => {
      connectAttemptRef.current += 1;
      clearReadyTimeout();
      setIsConnectionStarting(false);
      const session = realtimeRef.current;
      stopBrowserAudioCapture();
      session.stopAudioCapture();
      session.stopPlayback();
      session.disconnect();
      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      pendingCaptureStreamRef.current = null;
      audioQueueRef.current.clear();

      if (recordEnded && startedAtRef.current !== null) {
        setEndedDurationMs(Date.now() - startedAtRef.current);
        startedAtRef.current = null;
        return;
      }
      startedAtRef.current = null;
    },
    [clearReadyTimeout, stopBrowserAudioCapture]
  );

  const prewarm = useCallback(() => {
    prewarmRealtimeVoiceSetup(realtimeSessionConfig);
  }, [realtimeSessionConfig]);

  const connect = useCallback(async () => {
    const session = realtimeRef.current;
    if (session.status === 'connecting' || session.status === 'connected') {
      disconnect();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Realtime voice requires microphone access in this browser.');
      return;
    }

    setEndedDurationMs(null);
    setIsConnectionStarting(true);
    setMessages(transcriptControllerRef.current.reset());
    audioQueueRef.current.clear();

    const attempt = connectAttemptRef.current + 1;
    connectAttemptRef.current = attempt;
    clearReadyTimeout();
    let stopLateStream = false;
    const streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    readyTimeoutRef.current = setTimeout(() => {
      if (connectAttemptRef.current !== attempt || realtimeStatusRef.current === 'connected') {
        return;
      }

      stopLateStream = true;
      connectAttemptRef.current += 1;
      void streamPromise.then(stopStream).catch(() => undefined);
      logger.error('Realtime voice connection timed out', {
        status: realtimeStatusRef.current,
      });
      setIsConnectionStarting(false);
      stopBrowserAudioCapture();
      stopStream(mediaStreamRef.current);
      stopStream(pendingCaptureStreamRef.current);
      mediaStreamRef.current = null;
      pendingCaptureStreamRef.current = null;
      audioQueueRef.current.clear();
      realtimeRef.current.stopAudioCapture();
      realtimeRef.current.stopPlayback();
      realtimeRef.current.disconnect();
      startedAtRef.current = null;
      readyTimeoutRef.current = null;
      setErrorMessage(REALTIME_READY_TIMEOUT_MESSAGE);
    }, REALTIME_READY_TIMEOUT_MS);

    try {
      const setupBody = getRealtimeSetupRequestBody(realtimeSessionConfig);
      const connectPromise = connectRealtimeWithCsrf(() => session.connect(), { setupBody });
      const capturePromise = streamPromise.then(async (stream) => {
        if (stopLateStream || connectAttemptRef.current !== attempt) {
          stopStream(stream);
          return;
        }
        mediaStreamRef.current = stream;
        pendingCaptureStreamRef.current = stream;
        startedAtRef.current = Date.now();
        await startBrowserAudioCapture(stream);
        if (pendingCaptureStreamRef.current === stream) {
          pendingCaptureStreamRef.current = null;
        }
      });

      await Promise.all([connectPromise, capturePromise]);
    } catch (error) {
      stopLateStream = true;
      connectAttemptRef.current += 1;
      clearReadyTimeout();
      void streamPromise.then(stopStream).catch(() => undefined);
      setIsConnectionStarting(false);
      logger.error('Realtime voice connection failed', { error });
      stopBrowserAudioCapture();
      stopStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
      pendingCaptureStreamRef.current = null;
      audioQueueRef.current.clear();
      session.stopAudioCapture();
      session.disconnect();
      startedAtRef.current = null;
      setErrorMessage(formatRealtimeError(error));
    }
  }, [
    clearReadyTimeout,
    disconnect,
    realtimeSessionConfig,
    setErrorMessage,
    startBrowserAudioCapture,
    stopBrowserAudioCapture,
  ]);

  useEffect(() => {
    if (
      realtime.status !== 'connected' ||
      pendingCaptureStreamRef.current === null ||
      realtime.isCapturing ||
      isBrowserCapturing
    ) {
      return;
    }

    const stream = pendingCaptureStreamRef.current;
    pendingCaptureStreamRef.current = null;
    void startBrowserAudioCapture(stream);
  }, [isBrowserCapturing, realtime, startBrowserAudioCapture]);

  useEffect(() => {
    if (realtime.status !== 'error' && realtime.status !== 'disconnected') {
      return;
    }
    connectAttemptRef.current += 1;
    clearReadyTimeout();
    if (mediaStreamRef.current === null && pendingCaptureStreamRef.current === null) {
      return;
    }

    setIsConnectionStarting(false);
    realtimeRef.current.stopAudioCapture();
    stopBrowserAudioCapture();
    stopStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
    pendingCaptureStreamRef.current = null;
    audioQueueRef.current.clear();
    startedAtRef.current = null;
  }, [clearReadyTimeout, realtime.status, stopBrowserAudioCapture]);

  useEffect(() => () => disconnect(false), [disconnect]);

  const sdkMessages = useMemo<RealtimeVoiceTranscriptMessage[]>(() => {
    return realtime.messages
      .map<RealtimeVoiceTranscriptMessage | null>((message) => {
        const textParts = message.parts.flatMap((part): TextUIPartLike[] => {
          const textPart = part as { type?: unknown; text?: unknown; state?: unknown };
          return textPart.type === 'text' && typeof textPart.text === 'string'
            ? [{ type: 'text', text: textPart.text, state: textPart.state }]
            : [];
        });
        const text = textParts
          .map((part) => part.text)
          .join(' ')
          .trim();

        if (!text || (message.role !== 'user' && message.role !== 'assistant')) {
          return null;
        }

        return {
          id: message.id,
          role: message.role,
          text,
          isStreaming: textParts.some((part) => part.state === 'streaming'),
        };
      })
      .filter((message): message is RealtimeVoiceTranscriptMessage => message !== null);
  }, [realtime.messages]);

  const visibleMessages = messages.length > 0 ? messages : sdkMessages;
  const chatTranscriptMessages = useMemo(
    () => visibleMessages.filter((message) => message.isEphemeral !== true),
    [visibleMessages]
  );
  const visibleMessagesSignature = useMemo(
    () => getRealtimeTranscriptMessagesSignature(chatTranscriptMessages),
    [chatTranscriptMessages]
  );

  useEffect(() => {
    if (platformRuntime === 'desktop') {
      return;
    }
    if (lastMessagesNotificationSignatureRef.current === visibleMessagesSignature) {
      return;
    }
    lastMessagesNotificationSignatureRef.current = visibleMessagesSignature;
    onMessagesChange?.(chatTranscriptMessages);
  }, [chatTranscriptMessages, onMessagesChange, platformRuntime, visibleMessagesSignature]);

  if (platformRuntime === 'desktop') {
    return desktopRealtime;
  }

  return {
    endedDurationMs,
    isActive,
    isCapturing: isBrowserCapturing || realtime.isCapturing,
    isPlaying: realtime.isPlaying,
    messages: visibleMessages,
    status,
    connect,
    disconnect,
    prewarm,
  };
}
