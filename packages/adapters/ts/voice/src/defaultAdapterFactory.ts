// This file contains the default adapter factory which requires platform-specific dynamic imports
// It is excluded from coverage because the dynamic imports can only be tested in actual runtime environments
import { NoopVoiceAdapter } from './adapters/noop';
import type { VoiceAdapterFactory } from './types';

export const defaultAdapterFactory: VoiceAdapterFactory = async (platform) => {
  if (platform === 'web') {
    const { WebVoiceAdapter } = await import('./adapters/web');
    return new WebVoiceAdapter();
  }
  if (platform === 'desktop') {
    const { DesktopVoiceAdapter } = await import('./adapters/desktop');
    return new DesktopVoiceAdapter();
  }
  return new NoopVoiceAdapter();
};
