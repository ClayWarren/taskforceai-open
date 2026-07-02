import { voiceRecordingToBrowserFile } from '@taskforceai/client-runtime';
import { isVoiceCancellationError, useVoice } from '@taskforceai/voice';
import type { VoiceRecording } from '@taskforceai/voice';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from './logger';

interface UseVoiceControlProps {
  setErrorMessage: (message: string) => void;
  onTranscript?: (text: string) => void;
  onAudioCapture?: (audio: VoiceRecording) => void;
  onAudioCaptureFile?: (file: File) => void | Promise<void>;
  mode?: 'transcript' | 'audio';
}

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
      void voice.cancel();
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
      const reason =
        (voiceError instanceof Error && voiceError.message) ||
        (error instanceof Error ? error.message : null) ||
        'Voice input is unavailable in this browser.';
      setErrorMessage(reason);
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
      if (isVoiceCancellationError(error)) {
        return;
      }

      const isPermissionError =
        error instanceof Error &&
        (error.message.toLowerCase().includes('permission') ||
          error.message.toLowerCase().includes('denied') ||
          error.message.toLowerCase().includes('not-allowed'));

      if (isPermissionError) {
        logger.warn('Voice dictation access denied', { error });
      } else {
        logger.error('Voice dictation failed', { error });
      }

      const errorMessage =
        (error instanceof Error && error.message) ||
        'Unable to capture your voice. Please try again.';
      setErrorMessage(errorMessage);
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
