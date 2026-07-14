import {
  PendingPromptQueueProcessor,
  type PendingPromptQueueAdapter,
  type RunTaskResponse,
} from '@taskforceai/client-runtime/pending-prompt-queue';
import { useCallback, useEffect, useMemo } from 'react';

import { logger } from '../shared/logger';

export type { PendingPromptQueueAdapter, RunTaskResponse };

export interface UsePendingPromptQueueOptions {
  adapter: PendingPromptQueueAdapter;
  isOnline: boolean;
  isStreaming: boolean;
  retryDelaysMs?: number[];
}

export function usePendingPromptQueue({
  adapter,
  isOnline,
  isStreaming,
  retryDelaysMs,
}: UsePendingPromptQueueOptions) {
  const processor = useMemo(
    () =>
      new PendingPromptQueueProcessor({
        adapter,
        logger,
        retryDelaysMs,
        isNavigatorOnline: () =>
          typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean'
            ? true
            : navigator.onLine,
      }),
    [adapter, retryDelaysMs]
  );

  useEffect(() => {
    processor.setActive(true);
    return () => {
      processor.setActive(false);
    };
  }, [processor]);

  const processPendingPrompts = useCallback(async () => {
    processor.setEnvironment({
      isOnline,
      isStreaming,
    });
    await processor.processPendingPrompts();
  }, [isOnline, isStreaming, processor]);

  useEffect(() => {
    processor.setEnvironment({
      isOnline,
      isStreaming,
    });
    if (isOnline && !isStreaming) {
      void processPendingPrompts();
    }
  }, [isOnline, isStreaming, processPendingPrompts, processor]);

  return { processPendingPrompts };
}
