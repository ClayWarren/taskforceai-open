import type { VoiceAdapter } from '@taskforceai/voice';
import Constants, { AppOwnership, ExecutionEnvironment } from 'expo-constants';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import i18n from '../i18n';

type VoiceModule = typeof import('@react-native-voice/voice').default;

const VOICE_UNAVAILABLE_MESSAGE =
  'Speech recognition is unavailable in this build. Create a development build (https://docs.expo.dev/development/introduction/) to enable the microphone.';
const VOICE_CANCELLED_MESSAGE = 'Voice input cancelled.';

let cachedVoiceModule: VoiceModule | null | undefined;
type VoiceModuleState = 'unknown' | 'expo-go' | 'missing' | 'ready';
let voiceState: VoiceModuleState = 'unknown';
const logger = createModuleLogger('Voice');
const resolveRecognitionLocale = (): string =>
  i18n.resolvedLanguage || i18n.language || 'en-US';

const isExpoGoEnvironment =
  Constants?.appOwnership === AppOwnership.Expo ||
  Constants?.executionEnvironment === ExecutionEnvironment.StoreClient;

const loadVoiceModule = (): VoiceModule | null => {
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
    const module = require('@react-native-voice/voice') as { default?: VoiceModule };
    cachedVoiceModule = module.default ?? null;
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

const getVoiceModuleOrThrow = (): VoiceModule => {
  const voiceModule = loadVoiceModule();
  if (!voiceModule) {
    throw new Error(VOICE_UNAVAILABLE_MESSAGE);
  }
  return voiceModule;
};

export class MobileVoiceAdapter implements VoiceAdapter {
  private initialized = false;
  private cancelActiveListen: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      const voice = loadVoiceModule();
      if (voice) {
        await voice.getSpeechRecognitionServices();
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

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        this.cancelActiveListen = null;
        voice.removeAllListeners();
      };
      this.cancelActiveListen = () => {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.cancelled');
        cleanup();
        reject(new Error(VOICE_CANCELLED_MESSAGE));
      };

      voice.onSpeechResults = (event) => {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.success');
        const value = event.value?.[0] ?? '';
        cleanup();
        resolve(value);
      };

      voice.onSpeechError = (event) => {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.failure', {
          error: event.error?.message ?? 'unknown',
        });
        const error = new Error(event.error?.message ?? 'Speech recognition failed');
        cleanup();
        reject(error);
      };

      voice.start(resolveRecognitionLocale()).catch((error) => {
        stopTimer();
        mobileMetrics.incrementCounter('voice.recognition.failure', {
          error: error instanceof Error ? error.message : 'unknown',
        });
        cleanup();
        reject(error);
      });
    });
  }

  async record(): Promise<{ data: string; format: string }> {
    throw new Error('Native audio recording is not yet supported in Mobile.');
  }

  async cancel(): Promise<void> {
    try {
      this.cancelActiveListen?.();
      const voice = loadVoiceModule();
      if (voice) {
        await voice.cancel();
        voice.removeAllListeners();
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
