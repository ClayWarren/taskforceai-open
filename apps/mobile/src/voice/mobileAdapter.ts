import type { VoiceAdapter, VoiceRecording } from '@taskforceai/voice';
import Constants, { AppOwnership, ExecutionEnvironment } from 'expo-constants';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import AudioModule from 'expo-audio/build/AudioModule';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import i18n from '../i18n';
import { EncodingType, readAsStringAsync } from '../utils/file-system';

type SpeechRecognitionModule =
  typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;
type SpeechRecognitionResultEvent =
  import('expo-speech-recognition').ExpoSpeechRecognitionResultEvent;
type SpeechRecognitionErrorEvent =
  import('expo-speech-recognition').ExpoSpeechRecognitionErrorEvent;
type SpeechRecognitionSubscription = {
  remove: () => void;
};

const VOICE_UNAVAILABLE_MESSAGE =
  'Speech recognition is unavailable in this build. Create a development build (https://docs.expo.dev/development/introduction/) to enable the microphone.';
const VOICE_CANCELLED_MESSAGE = 'Voice input cancelled.';
const MAX_RECORDING_DURATION_MS = 60_000;

let cachedVoiceModule: SpeechRecognitionModule | null | undefined;
type VoiceModuleState = 'unknown' | 'expo-go' | 'missing' | 'ready';
let voiceState: VoiceModuleState = 'unknown';
const logger = createModuleLogger('Voice');
const resolveRecognitionLocale = (): string =>
  i18n.resolvedLanguage || i18n.language || 'en-US';

const isExpoGoEnvironment =
  Constants?.appOwnership === AppOwnership.Expo ||
  Constants?.executionEnvironment === ExecutionEnvironment.StoreClient;

const loadVoiceModule = (): SpeechRecognitionModule | null => {
  if (cachedVoiceModule !== undefined) {
    return cachedVoiceModule ?? null;
  }
  if (Platform.OS === 'web') {
    cachedVoiceModule = null;
    return null;
  }
  if (isExpoGoEnvironment) {
    if (voiceState !== 'expo-go') {
      logger.info(
        'Speech recognition requires a development build. Skipping native module load inside Expo Go.'
      );
      voiceState = 'expo-go';
    }
    cachedVoiceModule = null;
    return null;
  }
  try {
    // Type assertion justified: Dynamic require returns unknown; casting to expected module shape with optional default export
    const module = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule?: SpeechRecognitionModule;
    };
    cachedVoiceModule = module.ExpoSpeechRecognitionModule ?? null;
    voiceState = cachedVoiceModule ? 'ready' : 'missing';
  } catch (error) {
    if (voiceState !== 'missing') {
      logger.info(
        'Native speech recognition module is unavailable. Use a development build instead of Expo Go to enable voice input.',
        { error }
      );
      voiceState = 'missing';
    }
    cachedVoiceModule = null;
  }
  return cachedVoiceModule ?? null;
};

const getVoiceModuleOrThrow = (): SpeechRecognitionModule => {
  const voiceModule = loadVoiceModule();
  if (!voiceModule) {
    throw new Error(VOICE_UNAVAILABLE_MESSAGE);
  }
  return voiceModule;
};

export class MobileVoiceAdapter implements VoiceAdapter {
  private initialized = false;
  private cancelActiveListen: (() => void) | null = null;
  private finishActiveListen: (() => void) | null = null;
  private finishActiveRecord: (() => Promise<void>) | null = null;
  private cancelActiveRecord: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      const voice = loadVoiceModule();
      if (voice) {
        void voice.getSpeechRecognitionServices();
      } else {
        logger.warn('Speech recognition not available; falling back to TTS-only mode.');
      }
    } catch (error) {
      logger.debug('Speech recognition services unavailable on this platform', { error });
    }
    this.initialized = true;
  }

  async speak(text: string): Promise<void> {
    await this.init();
    return new Promise<void>((resolve) => {
      void Speech.stop();
      Speech.speak(text, {
        onDone: resolve,
        onStopped: resolve,
        onError: () => resolve(),
      });
    });
  }

  async listen(): Promise<string> {
    await this.init();
    const voice = getVoiceModuleOrThrow();
    const stopTimer = mobileMetrics.startTimer('voice.recognition.duration');

    const permissions = await voice.requestPermissionsAsync();
    if (!permissions.granted) {
      stopTimer();
      mobileMetrics.incrementCounter('voice.recognition.failure', { error: 'not-allowed' });
      throw new Error('Speech recognition permission was not granted.');
    }

    if (!voice.isRecognitionAvailable()) {
      stopTimer();
      mobileMetrics.incrementCounter('voice.recognition.failure', {
        error: 'service-not-allowed',
      });
      throw new Error('Speech recognition is not available on this device.');
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const subscriptions: SpeechRecognitionSubscription[] = [];
      const cleanup = () => {
        if (settled) return;
        settled = true;
        this.cancelActiveListen = null;
        this.finishActiveListen = null;
        for (const subscription of subscriptions) {
          subscription.remove();
        }
      };
      this.cancelActiveListen = () => {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.cancelled');
        try {
          voice.abort();
        } catch (error) {
          logger.debug('Failed to abort speech recognition', { error });
        }
        cleanup();
        reject(new Error(VOICE_CANCELLED_MESSAGE));
      };
      this.finishActiveListen = () => {
        try {
          voice.stop();
        } catch (error) {
          logger.debug('Failed to stop speech recognition', { error });
        }
      };

      subscriptions.push(
        voice.addListener('result', (event: SpeechRecognitionResultEvent) => {
          const value = event.results[0]?.transcript ?? '';
          if (!value && !event.isFinal) {
            return;
          }
          stopTimer();
          mobileMetrics.incrementCounter('voice.recognition.success');
          cleanup();
          resolve(value);
        })
      );

      subscriptions.push(
        voice.addListener('error', (event: SpeechRecognitionErrorEvent) => {
          stopTimer();
          const message =
            event.error === 'aborted'
              ? VOICE_CANCELLED_MESSAGE
              : event.message || 'Speech recognition failed';
          mobileMetrics.incrementCounter('voice.recognition.failure', {
            error: event.error ?? 'unknown',
          });
          cleanup();
          reject(new Error(message));
        })
      );

      subscriptions.push(
        voice.addListener('end', () => {
          if (settled) {
            return;
          }
          stopTimer();
          mobileMetrics.incrementCounter('voice.recognition.failure', { error: 'no-result' });
          cleanup();
          reject(new Error('Speech recognition ended without a result.'));
        })
      );

      try {
        voice.start({
          lang: resolveRecognitionLocale(),
          interimResults: false,
          continuous: false,
          maxAlternatives: 1,
        });
      } catch (error) {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.failure', {
          error: error instanceof Error ? error.message : 'unknown',
        });
        cleanup();
        reject(error);
      }
    });
  }

  async record(): Promise<VoiceRecording> {
    await this.init();
    if (this.finishActiveRecord || this.cancelActiveRecord) {
      await this.cancel();
    }

    const stopTimer = mobileMetrics.startTimer('voice.recording.duration');
    const permissions = await requestRecordingPermissionsAsync();
    if (!permissions.granted) {
      stopTimer();
      mobileMetrics.incrementCounter('voice.recording.failure', { error: 'not-allowed' });
      throw new Error('Microphone permission was not granted.');
    }

    return new Promise<VoiceRecording>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let recorder: AudioRecorder | null = null;

      const clearRecordTimeout = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
      };

      const cleanup = () => {
        clearRecordTimeout();
        this.finishActiveRecord = null;
        this.cancelActiveRecord = null;
        recorder = null;
      };

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        stopTimer();
        cleanup();
        reject(error);
      };

      const resolveOnce = (value: VoiceRecording) => {
        if (settled) return;
        settled = true;
        stopTimer();
        cleanup();
        resolve(value);
      };

      this.cancelActiveRecord = () => {
        if (settled) return;
        mobileMetrics.incrementCounter('voice.recording.cancelled');
        const activeRecorder = recorder;
        void activeRecorder?.stop().catch((error) => {
          logger.debug('Failed to stop cancelled recording', { error });
        });
        void setAudioModeAsync({ allowsRecording: false }).catch((error) => {
          logger.debug('Failed to reset cancelled recording audio mode', { error });
        });
        rejectOnce(new Error(VOICE_CANCELLED_MESSAGE));
      };

      this.finishActiveRecord = async () => {
        if (settled) return;
        const activeRecorder = recorder;
        if (!activeRecorder) {
          rejectOnce(new Error('No active recording to finish.'));
          return;
        }

        try {
          await activeRecorder.stop();
          const uri = activeRecorder.uri;
          if (!uri) {
            throw new Error('Voice recording did not produce an audio file.');
          }

          const filename = uri.split('/').pop() || 'voice-recording.m4a';
          const extension = filename.split('.').pop()?.toLowerCase() || 'm4a';
          const mimeType =
            extension === '3gp'
              ? 'audio/3gpp'
              : extension === 'wav'
                ? 'audio/wav'
                : extension === 'mp3'
                  ? 'audio/mpeg'
                  : 'audio/mp4';
          const data = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
          mobileMetrics.incrementCounter('voice.recording.success');
          resolveOnce({
            data,
            format: extension === '3gp' ? '3gp' : extension,
            filename,
            mimeType,
            uri,
          });
        } catch (error) {
          mobileMetrics.incrementCounter('voice.recording.failure', {
            error: error instanceof Error ? error.message : 'unknown',
          });
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        } finally {
          try {
            await setAudioModeAsync({ allowsRecording: false });
          } catch (error) {
            logger.debug('Failed to reset recording audio mode', { error });
          }
        }
      };

      void (async () => {
        try {
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
          });
          recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
          await recorder.prepareToRecordAsync();
          recorder.record();
          timeout = setTimeout(() => {
            void this.finishActiveRecord?.();
          }, MAX_RECORDING_DURATION_MS);
        } catch (error) {
          mobileMetrics.incrementCounter('voice.recording.failure', {
            error: error instanceof Error ? error.message : 'unknown',
          });
          void setAudioModeAsync({ allowsRecording: false }).catch((resetError) => {
            logger.debug('Failed to reset failed recording audio mode', { error: resetError });
          });
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  async finishListening(): Promise<void> {
    if (this.finishActiveRecord) {
      await this.finishActiveRecord();
      return;
    }

    if (this.finishActiveListen) {
      this.finishActiveListen();
      return;
    }

    this.cancelActiveListen?.();
  }

  async cancel(): Promise<void> {
    try {
      this.cancelActiveRecord?.();
      this.cancelActiveListen?.();
      const voice = loadVoiceModule();
      if (voice) {
        voice.abort();
      }
    } catch (error) {
      logger.debug('Failed to cancel voice recognition', { error });
    }
    try {
      await Speech.stop();
    } catch (error) {
      logger.debug('Failed to stop speech', { error });
    }
  }
}
