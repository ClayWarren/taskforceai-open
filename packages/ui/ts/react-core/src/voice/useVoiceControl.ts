import { voiceRecordingToBrowserFile } from '@taskforceai/client-runtime';
import { isVoiceCancellationError } from '@taskforceai/voice';
import type { VoiceRecording } from '@taskforceai/voice';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '../shared/logger';
import { useVoice } from '@taskforceai/react-core/useVoice';

interface UseVoiceControlProps {
  setErrorMessage: (message: string) => void;
  onTranscript?: (text: string) => void;
  onAudioCapture?: (audio: VoiceRecording) => void;
  onAudioCaptureFile?: (file: File) => void | Promise<void>;
  mode?: 'transcript' | 'audio';
}

const voiceInitializationError = (voiceError: unknown, initializationError: unknown): string => {
  if (voiceError instanceof Error && voiceError.message) return voiceError.message;
  if (initializationError instanceof Error && initializationError.message)
    return initializationError.message;
  return 'Voice input is unavailable in this browser.';
};

const reportVoiceCaptureError = (
  error: unknown,
  setErrorMessage: (message: string) => void
): void => {
  if (isVoiceCancellationError(error)) return;
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  const isPermissionError = ['permission', 'denied', 'not-allowed'].some((term) =>
    normalized.includes(term)
  );
  if (isPermissionError) logger.warn('Voice dictation access denied', { error });
  else logger.error('Voice dictation failed', { error });
  setErrorMessage(message || 'Unable to capture your voice. Please try again.');
};

export function useVoiceControl({
  setErrorMessage,
  onTranscript,
  onAudioCapture,
  onAudioCaptureFile,
  mode = 'transcript',
}: UseVoiceControlProps) {
  const { manager: voice, error: voiceError } = useVoice();
  const [isListening, setIsListening] = useState(false);
  const onAudioCaptureRef = useRef(onAudioCapture);
  const onAudioCaptureFileRef = useRef(onAudioCaptureFile);

  useEffect(() => {
    onAudioCaptureRef.current = onAudioCapture;
  }, [onAudioCapture]);

  useEffect(() => {
    onAudioCaptureFileRef.current = onAudioCaptureFile;
  }, [onAudioCaptureFile]);

  useEffect(() => {
    return () => {
      void voice.cancel().catch((error) => {
        logger.warn('Voice cancellation during cleanup failed', { error });
      });
    };
  }, [voice]);

  const cancelVoiceInput = useCallback(async () => {
    await voice.cancel();
    setIsListening(false);
  }, [voice]);

  const acceptVoiceInput = useCallback(async () => {
    if (typeof voice.finishListening === 'function') {
      await voice.finishListening();
      return;
    }
    await voice.cancel();
    setIsListening(false);
  }, [voice]);

  const handleVoiceButtonClick = useCallback(async () => {
    if (isListening) {
      await cancelVoiceInput();
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine && mode === 'transcript') {
      setErrorMessage(
        'Speech recognition requires an internet connection. You are currently offline.'
      );
      return;
    }

    try {
      await voice.init();
    } catch (error) {
      setErrorMessage(voiceInitializationError(voiceError, error));
      return;
    }
    setIsListening(true);
    try {
      const audioCaptureHandler = onAudioCaptureRef.current;
      const audioCaptureFileHandler = onAudioCaptureFileRef.current;
      if (mode === 'audio' && audioCaptureFileHandler) {
        const audio = await voice.record();
        let audioFile: File;
        try {
          audioFile = voiceRecordingToBrowserFile(audio);
        } catch (error) {
          logger.error('Voice recording conversion failed', { error });
          setErrorMessage('Failed to process audio recording.');
          return;
        }

        try {
          await audioCaptureFileHandler(audioFile);
        } catch (error) {
          logger.error('Voice recording processing failed', { error });
          setErrorMessage(error instanceof Error ? error.message : 'Failed to process audio.');
        }
      } else if (mode === 'audio' && audioCaptureHandler) {
        const audio = await voice.record();
        audioCaptureHandler(audio);
      } else if (onTranscript) {
        const transcript = await voice.listen();
        if (transcript.trim()) {
          onTranscript(transcript);
        }
      }
    } catch (error) {
      reportVoiceCaptureError(error, setErrorMessage);
    } finally {
      setIsListening(false);
    }
  }, [cancelVoiceInput, isListening, setErrorMessage, voice, voiceError, onTranscript, mode]);

  return {
    isListening,
    acceptVoiceInput,
    cancelVoiceInput,
    handleVoiceButtonClick,
  };
}
