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
  RealtimeVoiceSetupPrefetchCache,
  RealtimeVoiceTranscriptController,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceSessionConfig,
  type RealtimeVoiceServerEvent,
} from '@taskforceai/client-runtime';
import { getStoredToken } from '@taskforceai/contracts/auth/auth-storage';
import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../../../lib/logger';
import { usePlatformRuntime } from '../../../lib/platform/PlatformProvider';
import { RealtimeBrowserMicrophone } from './realtimeBrowserAudio';
import { useDesktopRealtimeVoiceSession } from './useDesktopRealtimeVoiceSession';

export type { RealtimeVoiceTranscriptMessage } from '@taskforceai/client-runtime';

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

const getCurrentOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
};

const isRealtimeSetupRequest = (input: RequestInfo | URL): boolean => {
  const currentOrigin = getCurrentOrigin();
  let url: URL;
  if (typeof input === 'string') {
    try {
      url = new URL(input, currentOrigin);
    } catch {
      return false;
    }
  } else if (input instanceof URL) {
    url = input;
  } else {
    try {
      url = new URL(input.url);
    } catch {
      return false;
    }
  }
  return url.origin === currentOrigin && url.pathname === REALTIME_SETUP_ENDPOINT;
};

type RealtimeVoiceSetupPayload = Record<string, unknown> & {
  token?: unknown;
  expiresAt?: unknown;
};

const prefetchedRealtimeSetupCache =
  new RealtimeVoiceSetupPrefetchCache<RealtimeVoiceSetupPayload>();
let realtimeSetupPrefetchPromise: Promise<void> | null = null;

const getRealtimeSetupRequestBody = (
  sessionConfig: Experimental_UseRealtimeOptions['sessionConfig']
): string => JSON.stringify({ sessionConfig });

const getRealtimeSetupCacheKey = (body: string, authBinding: string): string =>
  `${authBinding}\u001f${body}`;

const getRequestBodyString = (init?: RequestInit): string | null =>
  typeof init?.body === 'string' ? init.body : null;

type RealtimeFetchContext = {
  setupBody?: string;
};

const realtimeFetchContexts: RealtimeFetchContext[] = [];
let realtimeFetchBase: typeof fetch | null = null;
let realtimeFetchDispatcher: typeof fetch | null = null;

const consumePrefetchedRealtimeSetupResponse = async (
  body: string,
  authBinding: string | null
): Promise<Response | null> => {
  if (realtimeSetupPrefetchPromise) {
    await realtimeSetupPrefetchPromise.catch(() => undefined);
  }

  if (!authBinding) {
    return null;
  }

  const payload = prefetchedRealtimeSetupCache.consume(getRealtimeSetupCacheKey(body, authBinding));
  if (!payload) {
    return null;
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
};

const selectRealtimeFetchContext = (requestBody: string | null): RealtimeFetchContext | null => {
  if (requestBody) {
    for (let index = realtimeFetchContexts.length - 1; index >= 0; index -= 1) {
      const context = realtimeFetchContexts[index];
      if (context?.setupBody === requestBody) {
        return context;
      }
    }
  }

  return realtimeFetchContexts.at(-1) ?? null;
};

const createRealtimeFetchDispatcher = (baseFetch: typeof fetch): typeof fetch =>
  Object.assign(
    (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (!isRealtimeSetupRequest(input)) {
        return baseFetch(input, init);
      }

      const requestBody = getRequestBodyString(init);
      const context = selectRealtimeFetchContext(requestBody);
      const token = getStoredToken();
      if (context?.setupBody && requestBody === context.setupBody) {
        const prefetchedResponse = await consumePrefetchedRealtimeSetupResponse(
          context.setupBody,
          token.ok ? token.value : null
        );
        if (prefetchedResponse) {
          return prefetchedResponse;
        }
      }

      const csrfToken = await getCsrfToken();
      const headers = new Headers(init?.headers);
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      if (token.ok) {
        headers.set('authorization', `Bearer ${token.value}`);
      }
      return baseFetch(input, { ...init, headers });
    }) as typeof fetch,
    typeof baseFetch.preconnect === 'function'
      ? { preconnect: baseFetch.preconnect.bind(baseFetch) }
      : {}
  );

const acquireRealtimeFetchContext = (context: RealtimeFetchContext): (() => void) => {
  if (!realtimeFetchBase || globalThis.fetch !== realtimeFetchDispatcher) {
    realtimeFetchContexts.length = 0;
    realtimeFetchBase = globalThis.fetch;
    realtimeFetchDispatcher = createRealtimeFetchDispatcher(realtimeFetchBase);
    globalThis.fetch = realtimeFetchDispatcher;
  }

  realtimeFetchContexts.push(context);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    const index = realtimeFetchContexts.lastIndexOf(context);
    if (index >= 0) {
      realtimeFetchContexts.splice(index, 1);
    }

    if (realtimeFetchContexts.length > 0) {
      return;
    }

    if (realtimeFetchBase && globalThis.fetch === realtimeFetchDispatcher) {
      globalThis.fetch = realtimeFetchBase;
    }
    realtimeFetchBase = null;
    realtimeFetchDispatcher = null;
  };
};

export const prewarmRealtimeVoiceSetup = (
  sessionConfig: Experimental_UseRealtimeOptions['sessionConfig']
): void => {
  if (typeof globalThis.fetch !== 'function') {
    return;
  }

  const body = getRealtimeSetupRequestBody(sessionConfig);
  const token = getStoredToken();
  if (!token.ok) {
    prefetchedRealtimeSetupCache.clear();
    return;
  }

  const cacheKey = getRealtimeSetupCacheKey(body, token.value);
  if (prefetchedRealtimeSetupCache.hasUsable(cacheKey)) {
    return;
  }
  if (realtimeSetupPrefetchPromise) {
    return;
  }

  realtimeSetupPrefetchPromise = (async () => {
    const csrfToken = await getCsrfToken();
    const headers = new Headers({
      'content-type': 'application/json',
    });
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    if (token.ok) {
      headers.set('authorization', `Bearer ${token.value}`);
    }

    const response = await fetch(REALTIME_SETUP_ENDPOINT, {
      method: 'POST',
      headers,
      body,
    });
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as RealtimeVoiceSetupPayload;
    if (!payload || typeof payload !== 'object' || typeof payload.token !== 'string') {
      return;
    }

    prefetchedRealtimeSetupCache.store(cacheKey, payload);
  })()
    .catch((error) => {
      logger.debug('Realtime voice setup prewarm failed', { error });
    })
    .finally(() => {
      realtimeSetupPrefetchPromise = null;
    });
};

export const connectRealtimeWithCsrf = async (
  connect: () => Promise<void>,
  options: { setupBody?: string } = {}
): Promise<void> => {
  const csrfToken = await getCsrfToken();
  const token = getStoredToken();
  if (!csrfToken && !token.ok) {
    throw new Error('Sign in to use realtime voice.');
  }

  const releaseFetchContext = acquireRealtimeFetchContext({ setupBody: options.setupBody });
  try {
    await connect();
  } finally {
    releaseFetchContext();
  }
};

const warmRealtimeVoiceSetup = () => {
  if (typeof globalThis.fetch?.preconnect === 'function') {
    try {
      globalThis.fetch.preconnect(REALTIME_SETUP_ENDPOINT);
    } catch (error) {
      logger.debug('Realtime voice preconnect failed', { error });
    }
  }

  void getCsrfToken().catch((error) => {
    logger.debug('Realtime voice CSRF prewarm failed', { error });
  });
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
