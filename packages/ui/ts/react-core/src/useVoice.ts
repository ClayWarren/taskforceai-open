import { useCallback, useMemo, useSyncExternalStore } from 'react';

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

export const useVoice = (): UseVoiceResult => {
  const manager = useMemo(() => voiceManager, []);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return manager.subscribe(onStoreChange);
    },
    [manager]
  );
  const getStatus = useCallback(() => manager.getStatus(), [manager]);
  const getError = useCallback(() => manager.getError(), [manager]);
  const status = useSyncExternalStore(subscribe, getStatus, getStatus);
  const error = useSyncExternalStore(subscribe, getError, getError);

  return { manager, status, error };
};
