import { PendingPromptQueueProcessor } from '@taskforceai/client-runtime/pending-prompt-queue';
import { useCallback, useEffect, useMemo } from 'react';

import { logger } from './logger';
import type { PendingPromptRecord } from './types';
import type { StartStreamingOptions } from './stores/createStreamingStore';

export interface RunTaskResponse {
  task_id: string;
}

export interface PendingPromptQueueAdapter {
  listPendingPrompts: () => Promise<PendingPromptRecord[]>;
  updatePromptStatus: (id: number, status: PendingPromptRecord['status']) => Promise<void>;
  removePrompt: (id: number) => Promise<void>;
  runTask: (
    prompt: string,
    options: {
      idempotencyKey: string;
      modelId?: string;
      attachmentIds?: string[];
      runPayload?: PendingPromptRecord['runPayload'];
    }
  ) => Promise<RunTaskResponse>;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
}

export interface UsePendingPromptQueueOptions {
  adapter: PendingPromptQueueAdapter;
  isOnline: boolean;
  isStreaming: boolean;
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS: number[] = [1000, 5000, 15000];

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
        retryDelaysMs: retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
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
