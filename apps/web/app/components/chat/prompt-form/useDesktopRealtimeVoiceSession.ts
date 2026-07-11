import {
  applyRealtimeVoiceTranscriptEvent,
  buildRealtimeVoiceSessionConfig,
  fetchRealtimeVoiceSetup,
  RealtimeVoiceAudioSender,
  RealtimeVoiceSocketController,
  RealtimeVoiceTranscriptController,
  type RealtimeVoiceClientEvent,
  type RealtimeVoiceServerEvent,
  type RealtimeVoiceTranscriptMessage,
} from '@taskforceai/client-runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { openRealtimeVoiceSocket } from '../../../lib/api/realtime-voice-socket';
import { logger } from '../../../lib/logger';
import { createVoiceGatewayRequestOptions } from '../../../lib/platform/desktop/voice-gateway';
import { RealtimeBrowserMicrophone, RealtimeBrowserPcmPlayer } from './realtimeBrowserAudio';

type DesktopRealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const ACTIVE_USER_TRANSCRIPT_ID = 'user-active-desktop-speech';

const toRealtimeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Realtime voice is unavailable. Please try again.';

export function useDesktopRealtimeVoiceSession({
  setErrorMessage,
}: {
  setErrorMessage: (message: string) => void;
}) {
  const [status, setStatus] = useState<DesktopRealtimeStatus>('disconnected');
  const [messages, setMessages] = useState<RealtimeVoiceTranscriptMessage[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [endedDurationMs, setEndedDurationMs] = useState<number | null>(null);
  const socketControllerRef = useRef(new RealtimeVoiceSocketController());
  const eventSenderRef = useRef(
    new RealtimeVoiceAudioSender({
      getSocket: () => socketControllerRef.current.current,
    })
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const microphoneRef = useRef<RealtimeBrowserMicrophone | null>(null);
  const playerRef = useRef<RealtimeBrowserPcmPlayer | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const isDisconnectingRef = useRef(false);
  const transcriptControllerRef = useRef(
    new RealtimeVoiceTranscriptController(ACTIVE_USER_TRANSCRIPT_ID)
  );

  const getMicrophone = useCallback(() => {
    microphoneRef.current ??= new RealtimeBrowserMicrophone();
    return microphoneRef.current;
  }, []);

  const getPlayer = useCallback(() => {
    playerRef.current ??= new RealtimeBrowserPcmPlayer(setIsPlaying);
    return playerRef.current;
  }, []);

  const recordEndedDuration = useCallback((recordEnded: boolean) => {
    if (!recordEnded || startedAtRef.current === null) {
      startedAtRef.current = null;
      return;
    }
    setEndedDurationMs(Date.now() - startedAtRef.current);
    startedAtRef.current = null;
  }, []);

  const sendEvent = useCallback((event: RealtimeVoiceClientEvent) => {
    eventSenderRef.current.send(event);
  }, []);

  const applyTranscriptEvent = useCallback((event: RealtimeVoiceServerEvent) => {
    const nextMessages = applyRealtimeVoiceTranscriptEvent(transcriptControllerRef.current, event);
    if (nextMessages) {
      setMessages(nextMessages);
    }
  }, []);

  const handleServerEvent = useCallback(
    (event: RealtimeVoiceServerEvent) => {
      switch (event.type) {
        case 'session-created':
        case 'session-updated':
          setStatus('connected');
          return;
        case 'speech-started':
          getPlayer().stop();
          applyTranscriptEvent(event);
          return;
        case 'speech-stopped':
          applyTranscriptEvent(event);
          return;
        case 'audio-delta':
          if (typeof event.delta === 'string') {
            getPlayer().enqueue(event.delta);
          }
          return;
        case 'input-transcription-completed':
          applyTranscriptEvent(event);
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
          const message =
            typeof event.message === 'string' ? event.message : 'Realtime voice failed.';
          logger.error('Realtime voice server error', { error: message });
          setErrorMessage(message);
          setStatus('error');
          return;
        }
        default:
          return;
      }
    },
    [applyTranscriptEvent, getPlayer, setErrorMessage]
  );

  const disconnect = useCallback(
    (recordEnded = true) => {
      isDisconnectingRef.current = true;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      getMicrophone().stop();
      setIsCapturing(false);
      getPlayer().stop();

      socketControllerRef.current.closeCurrent((error) => {
        logger.warn('Failed to close realtime voice socket', { error });
      });

      recordEndedDuration(recordEnded);
      setStatus('disconnected');
      isDisconnectingRef.current = false;
    },
    [getMicrophone, getPlayer, recordEndedDuration]
  );

  const connect = useCallback(async () => {
    if (status === 'connecting' || status === 'connected') {
      disconnect();
      return;
    }

    if (typeof WebSocket === 'undefined') {
      setErrorMessage('Realtime voice is unavailable in this desktop webview.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Realtime voice requires microphone access in this desktop webview.');
      return;
    }

    setStatus('connecting');
    setEndedDurationMs(null);
    setMessages(transcriptControllerRef.current.reset());

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const sessionConfig = buildRealtimeVoiceSessionConfig();
      const setup = await fetchRealtimeVoiceSetup({
        ...(await createVoiceGatewayRequestOptions('desktop')),
        sessionConfig,
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const socket = openRealtimeVoiceSocket(setup.url, setup.token);
      startedAtRef.current = Date.now();

      const handleOpen = () => {
        void (async () => {
          try {
            await getMicrophone().start(stream, (audio) => {
              sendEvent({ type: 'input-audio-append', audio });
            });
            if (!socketControllerRef.current.isCurrent(socket)) {
              getMicrophone().stop();
              return;
            }

            setStatus('connected');
            sendEvent({
              type: 'session-update',
              config: {
                ...sessionConfig,
                tools: setup.tools ?? [],
              },
            });
            setIsCapturing(true);
          } catch (error) {
            logger.error('Realtime voice microphone failed', { error });
            setErrorMessage(toRealtimeErrorMessage(error));
            setStatus('error');
            try {
              socket.close();
            } catch (closeError) {
              logger.warn('Failed to close realtime voice socket after microphone error', {
                error: closeError,
              });
            }
          }
        })();
      };

      const handleError = (event: Event) => {
        logger.error('Realtime voice socket failed', { error: event });
        setErrorMessage('Realtime voice connection failed.');
        setStatus('error');
      };

      const handleClose = () => {
        socketControllerRef.current.clear(socket);
        getMicrophone().stop();
        setIsCapturing(false);
        getPlayer().stop();
        recordEndedDuration(true);
        setStatus((currentStatus) =>
          currentStatus === 'error' || isDisconnectingRef.current ? currentStatus : 'disconnected'
        );
      };

      socketControllerRef.current.bind(socket, {
        onOpen: handleOpen,
        onServerEvent: handleServerEvent,
        onError: handleError,
        onClose: handleClose,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      logger.error('Realtime voice session failed', { error });
      setErrorMessage(toRealtimeErrorMessage(error));
      setStatus('error');
      disconnect(false);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, [
    disconnect,
    getMicrophone,
    getPlayer,
    handleServerEvent,
    recordEndedDuration,
    sendEvent,
    setErrorMessage,
    status,
  ]);

  useEffect(
    () => () => {
      disconnect(false);
      microphoneRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [disconnect]
  );

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.text.trim().length > 0),
    [messages]
  );

  return {
    connect,
    disconnect,
    endedDurationMs,
    isActive: status === 'connecting' || status === 'connected',
    isCapturing,
    isPlaying,
    messages: visibleMessages,
    prewarm: () => undefined,
    status,
  };
}
