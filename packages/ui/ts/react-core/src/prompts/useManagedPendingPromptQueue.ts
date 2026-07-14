import type { RunRequest } from '@taskforceai/contracts/contracts';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { useMemo, useRef } from 'react';

import {
  createPendingPromptQueueAdapter,
  type PendingPromptQueueStorageAdapter,
} from './pendingPromptQueueAdapter';
import type { StartStreamingOptions } from '../streaming/createStreamingStore';
import type { RunTaskResponse } from './usePendingPromptQueue';
import { usePendingPromptQueue } from './usePendingPromptQueue';

export interface ManagedPendingPromptQueueOptions {
  storage: PendingPromptQueueStorageAdapter;
  runTask: (body: RunRequest) => Promise<RunTaskResponse>;
  startStreaming: (options: StartStreamingOptions) => Promise<void>;
  invalidatePendingPrompts?: () => void;
  isOnline: boolean;
  isStreaming: boolean;
  retryDelaysMs?: number[];
}

export const useManagedPendingPromptQueue = ({
  storage,
  runTask,
  startStreaming,
  invalidatePendingPrompts,
  isOnline,
  isStreaming,
  retryDelaysMs,
}: ManagedPendingPromptQueueOptions) => {
  const storageRef = useRef(storage);
  const runTaskRef = useRef(runTask);
  const startStreamingRef = useRef(startStreaming);
  const invalidatePendingPromptsRef = useRef(invalidatePendingPrompts);

  storageRef.current = storage;
  runTaskRef.current = runTask;
  startStreamingRef.current = startStreaming;
  invalidatePendingPromptsRef.current = invalidatePendingPrompts;

  const adapter = useMemo(
    () =>
      createPendingPromptQueueAdapter({
        storage: {
          listPendingPrompts: () => storageRef.current.listPendingPrompts(),
          updatePromptStatus: (id, status) => storageRef.current.updatePromptStatus(id, status),
          removePrompt: (id) => storageRef.current.removePrompt(id),
        },
        runTask: (body) => runTaskRef.current(body),
        startStreaming: (options) => startStreamingRef.current(options),
        invalidatePendingPrompts: () => {
          invalidatePendingPromptsRef.current?.();
        },
      }),
    []
  );

  return usePendingPromptQueue({
    adapter,
    isOnline,
    isStreaming,
    ...definedProps({ retryDelaysMs }),
  });
};
