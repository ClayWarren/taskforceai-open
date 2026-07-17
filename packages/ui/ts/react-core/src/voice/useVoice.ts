import { useSyncExternalStore } from 'react';

import { voiceManager } from '@taskforceai/voice';
import type { VoiceAdapter, VoiceRecording, VoiceStatus } from '@taskforceai/voice/types';

export interface UseVoiceResult {
  manager: {
    setAdapter(adapter: VoiceAdapter): void;
    getStatus(): VoiceStatus;
    getError(): Error | null;
    init(): Promise<void>;
    speak(text: string): Promise<void>;
    listen(): Promise<string>;
    record(): Promise<VoiceRecording>;
    finishListening(): Promise<void>;
    cancel(): Promise<void>;
  };
  status: VoiceStatus;
  error: Error | null;
}

const subscribe = (onStoreChange: () => void) => voiceManager.subscribe(onStoreChange);
const getStatus = () => voiceManager.getStatus();
const getError = () => voiceManager.getError();

export const useVoice = (): UseVoiceResult => {
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  const error = useSyncExternalStore(subscribe, getError, getError);

  return { manager: voiceManager, status, error };
};
