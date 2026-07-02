import { useEffect, useMemo, useState } from 'react';

import { voiceManager } from './VoiceManager';
import type { VoiceAdapter, VoiceRecording, VoiceStatus } from './types';

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
  const [status, setStatus] = useState<VoiceStatus>(manager.getStatus());
  const [error, setError] = useState<Error | null>(manager.getError());

  useEffect(() => {
    const unsubscribe = manager.subscribe((nextStatus: VoiceStatus, nextError: Error | null) => {
      setStatus(nextStatus);
      setError(nextError);
    });

    return unsubscribe;
  }, [manager]);

  return { manager, status, error };
};
