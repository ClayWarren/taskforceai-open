import {
  createResultPendingPromptQueueStorage,
  type StartStreamingOptions,
  type StreamSettlement,
  useManagedPendingPromptQueue,
} from '@taskforceai/react-core';

import { getMobileClient } from '../api/client';
import { mobileLogger } from '../logger';
import { listPendingPrompts, removePrompt, updatePromptStatus } from '../storage/chat-local-mobile';
import type { StartStreamingOptions as MobileStartStreamingOptions } from '../streaming/useStreamingStore';

type MobileStartStreaming = (options: MobileStartStreamingOptions) => Promise<void>;

interface UseMobilePendingPromptQueueOptions {
  isOnline: boolean;
  isStreaming: boolean;
  startStreaming: MobileStartStreaming;
  invalidatePendingPrompts?: () => void;
}

const logger = mobileLogger.child({ module: 'usePendingPromptQueue' });

const MOBILE_RETRY_DELAYS_MS = [100, 250, 500];

export function usePendingPromptQueue({
  isOnline,
  isStreaming,
  startStreaming,
  invalidatePendingPrompts,
}: UseMobilePendingPromptQueueOptions) {
  return useManagedPendingPromptQueue({
    storage: createResultPendingPromptQueueStorage({
      listPendingPrompts,
      updatePromptStatus,
      removePrompt,
      logger,
    }),
    runTask: async (body) => {
      const client = getMobileClient();
      const response = await client.runTask(body);
      return { task_id: response.task_id };
    },
    startStreaming: async (options: StartStreamingOptions) => {
      await startStreaming({
        taskId: options.taskId,
        conversationId: options.conversationId,
        prompt: options.prompt,
        onSettled: options.onSettled as ((reason: StreamSettlement) => void) | undefined,
      });
    },
    invalidatePendingPrompts,
    isOnline,
    isStreaming,
    retryDelaysMs: MOBILE_RETRY_DELAYS_MS,
  });
}
