import type { VoiceAdapter } from '../types';

export class NoopVoiceAdapter implements VoiceAdapter {
  async init(): Promise<void> {
    throw new Error('Voice features are not supported on this platform.');
  }
  async speak(_text: string): Promise<void> {
    throw new Error('Voice features are not supported on this platform.');
  }
  async listen(): Promise<string> {
    throw new Error('Voice features are not supported on this platform.');
  }
  async record(): Promise<{ data: string; format: string }> {
    throw new Error('Voice features are not supported on this platform.');
  }
  async cancel(): Promise<void> {
    return;
  }
}
