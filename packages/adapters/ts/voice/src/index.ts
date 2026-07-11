import type {
  VoiceAdapter,
  VoiceAdapterFactory,
  VoicePlatform,
  VoiceRecording,
  VoiceStatus,
} from './types';

export { voiceManager } from './VoiceManager';
export { configureVoiceLogger } from './logger';
export { isVoiceCancellationError } from './errors';
export type { VoiceAdapter, VoiceAdapterFactory, VoicePlatform, VoiceRecording, VoiceStatus };
