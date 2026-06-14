export interface VoiceAdapter {
  init(): Promise<void>;
  speak(text: string): Promise<void>;
  listen(): Promise<string>;
  record(): Promise<{ data: string; format: string }>;
  cancel(): Promise<void>;
}

export type VoicePlatform = 'web' | 'mobile' | 'desktop' | 'unknown';

export type VoiceStatus = 'idle' | 'initializing' | 'ready' | 'error';

export type VoiceAdapterFactory = (platform: VoicePlatform) => Promise<VoiceAdapter>;

export { isVoiceCancellationError } from './errors';
