import {
  transcribeDictationAudio,
  voiceRecordingToDictationAudioInput,
} from '@taskforceai/client-runtime';
import { isVoiceCancellationError } from '@taskforceai/voice';
import { useVoice } from '@taskforceai/react-core/useVoice';
import type { VoiceRecording } from '@taskforceai/voice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { createModuleLogger } from '../logger';
import { deleteAsync } from '../utils/file-system';
import { createMobileVoiceGatewayRequestOptions } from '../voice/voiceGatewayClient';

const logger = createModuleLogger('usePromptVoice');

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
  if (typeof globalThis.clearTimeout === 'function') {
    globalThis.clearTimeout(timer);
  }
};

const voiceUnavailableReason = (voiceError: unknown, initializationError: unknown): string => {
  if (voiceError instanceof Error) return voiceError.message;
  if (initializationError instanceof Error) return initializationError.message;
  return 'Voice input is not available on this device.';
};

export function usePromptVoice() {
  const { manager: voice, error: voiceError } = useVoice();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcriptionHint, setTranscriptionHint] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Bug #13 fix: the original code returned early before the cleanup function
    // was established. When transcriptionHint was set to an empty string, the
    // effect exited without cancelling the previously started 3-second timer,
    // leaving it orphaned. Always define the cleanup so prior timers are
    // reliably cancelled when the effect re-runs or on unmount.
    if (!transcriptionHint) {
      return undefined;
    }
    const timer = setTimeout(() => setTranscriptionHint(null), 3000);
    return () => clearTimer(timer);
  }, [transcriptionHint]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const startListening = useCallback(async (onTranscript: (text: string) => void) => {
    if (isProcessing) return;

    if (isListening) {
      return;
    }

    setIsProcessing(true);
    try {
      try {
        await voice.init();
      } catch (error) {
        if (!mountedRef.current) return;
        const reason = voiceUnavailableReason(voiceError, error);
        Alert.alert('Voice Unavailable', reason);
        return;
      }
      if (!mountedRef.current) return;
      setIsListening(true);
      setIsProcessing(false);
      let recording: VoiceRecording | null = null;
      try {
        const capturedRecording = await voice.record();
        recording = capturedRecording;
        if (!mountedRef.current) return;
        setIsProcessing(true);
        const transcript = await transcribeDictationAudio(
          voiceRecordingToDictationAudioInput(capturedRecording),
          await createMobileVoiceGatewayRequestOptions()
        );
        if (!mountedRef.current) return;
        if (transcript.trim()) {
          onTranscript(transcript);
          setTranscriptionHint('Voice input added');
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (isVoiceCancellationError(err)) return;
        logger.error('Voice dictation failed', { error: err });
        const errorMessage =
          (err instanceof Error && err.message) || 'Unable to capture your voice. Please try again.';
        Alert.alert('Voice Input', errorMessage);
      } finally {
        if (recording?.uri) {
          void deleteAsync(recording.uri, { idempotent: true }).catch((error) => {
            logger.warn('Failed to remove temporary dictation recording', { error });
          });
        }
        if (mountedRef.current) {
          setIsListening(false);
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  }, [isListening, isProcessing, voice, voiceError]);

  const cancelListening = useCallback(async () => {
    await voice.cancel();
    if (!mountedRef.current) return;
    setIsListening(false);
  }, [voice]);

  const acceptListening = useCallback(async () => {
    await voice.finishListening();
  }, [voice]);

  useEffect(() => {
    return () => {
      void voice.cancel();
    };
  }, [voice]);

  return {
    isListening,
    transcriptionHint,
    startListening,
    acceptListening,
    cancelListening,
    stopListening: cancelListening,
  };
}
