'use client';

import { useEffect, useMemo, useState } from 'react';

import { type StartStreamingOptions, useManagedPendingPromptQueue } from '@taskforceai/react-core';

import { runTask } from '@taskforceai/api-client/api/tasks';
import { useConversationStore } from '../platform/PlatformProvider';

type StartStreamingFn = (options: StartStreamingOptions) => Promise<void>;

interface UseWebPendingPromptsConfig {
  isStreaming: boolean;
  startStreaming: StartStreamingFn;
  isAuthenticated: boolean;
  enabled?: boolean;
}

const WEB_RETRY_DELAYS_MS = [1000, 5000, 15000];

export const usePendingPrompts = ({
  isStreaming,
  startStreaming,
  isAuthenticated,
  enabled = true,
}: UseWebPendingPromptsConfig) => {
  const conversationStore = useConversationStore();
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  });

  const result = useManagedPendingPromptQueue({
    storage: useMemo(
      () => ({
        listPendingPrompts: () => conversationStore.listPendingPrompts(),
        updatePromptStatus: (id, status) => conversationStore.updatePromptStatus(id, status),
        removePrompt: (id) => conversationStore.removePrompt(id),
      }),
      [conversationStore]
    ),
    runTask: async (body) => {
      const response = await runTask(body);
      if (!response.ok) {
        throw response.error;
      }
      return response.value;
    },
    startStreaming: (options: StartStreamingOptions) => startStreaming(options),
    isOnline: enabled && isOnline && isAuthenticated,
    isStreaming,
    retryDelaysMs: WEB_RETRY_DELAYS_MS,
  });

  const processPendingPrompts = result.processPendingPrompts;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      setIsOnline(true);
      if (enabled) {
        void processPendingPrompts();
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled, processPendingPrompts]);

  return { processPendingPrompts };
};
