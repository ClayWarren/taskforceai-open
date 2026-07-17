export interface VoiceRecording {
  data: string;
  format: string;
  filename?: string;
  mimeType?: string;
  uri?: string;
}

export interface VoiceAdapter {
  init(): Promise<void>;
  speak(text: string): Promise<void>;
  listen(): Promise<string>;
  finishListening?(): Promise<void>;
  record(): Promise<VoiceRecording>;
  cancel(): Promise<void>;
}

export type VoicePlatform = 'web' | 'mobile' | 'desktop' | 'unknown';

export type VoiceStatus = 'idle' | 'initializing' | 'ready' | 'error';

export type VoiceAdapterFactory = (platform: VoicePlatform) => Promise<VoiceAdapter>;
