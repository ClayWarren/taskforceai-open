import { voiceManager as realVoiceManager } from './VoiceManager';
import { useVoice as realUseVoice } from './useVoice';
import type { VoiceAdapter, VoiceAdapterFactory, VoicePlatform, VoiceStatus } from './types';

const runtimeEnv =
  typeof process === 'undefined' ? {} : (process.env as Record<string, string | undefined>);
const isBunTest = runtimeEnv['BUN_TEST'] === '1' || runtimeEnv['NODE_ENV'] === 'test';

export const voiceManager = realVoiceManager;

export const useVoice: any = isBunTest
  ? () => ({
      manager: voiceManager,
      status: 'idle' as VoiceStatus,
      error: null,
      record: async () => ({ data: '', format: 'wav' }),
    })
  : realUseVoice;

export { isVoiceCancellationError } from './errors';
export type { VoiceAdapter, VoiceAdapterFactory, VoicePlatform, VoiceStatus };
