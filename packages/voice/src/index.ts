import { env, isTest } from '@taskforceai/shared/config/env';

import { voiceManager as realVoiceManager } from './VoiceManager';
import { useVoice as realUseVoice } from './useVoice';
import type {
  VoiceAdapter,
  VoiceAdapterFactory,
  VoicePlatform,
  VoiceRecording,
  VoiceStatus,
} from './types';

const isBunTest = env.BUN_TEST === '1' || isTest;

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
export type { VoiceAdapter, VoiceAdapterFactory, VoicePlatform, VoiceRecording, VoiceStatus };
