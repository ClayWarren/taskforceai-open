import { StreamingStoreAdapter } from '@taskforceai/react-core';
import { detectRuntime } from '@taskforceai/shared/utils/runtime';
import { definedProps } from '@taskforceai/shared/utils/object';
import { cancelTask } from '@taskforceai/contracts/api/tasks';
import { createBrowserStreamingRuntime } from '../platform/browser/streaming-runtime';
import { StreamingRuntime, StreamingRuntimeHandlers } from '../platform/platform-interfaces';
import { logger } from '../logger';

let desktopStreamingRuntimePromise: Promise<StreamingRuntime> | null = null;
const loadDesktopStreamingRuntime = async (): Promise<StreamingRuntime> => {
  if (!desktopStreamingRuntimePromise) {
    desktopStreamingRuntimePromise = import('../platform/desktop/streaming-runtime').then(
      (module) => module.createDesktopStreamingRuntime()
    );
  }
  return desktopStreamingRuntimePromise;
};

export const createWebStreamingAdapter = (): StreamingStoreAdapter => {
  return {
    debug: import.meta.env?.VITE_STREAMING_DEBUG === '1',
    logger,
    connect: async (taskId, onMessage, onError, onOpen) => {
      const runtimeType = detectRuntime();
      let runtime: StreamingRuntime;

      if (runtimeType === 'desktop') {
        runtime = await loadDesktopStreamingRuntime();
      } else {
        runtime = createBrowserStreamingRuntime();
      }

      const handlers: StreamingRuntimeHandlers = {
        onMessage,
        onError,
        ...definedProps({ onOpen }),
      };

      await runtime.startStreaming(taskId, handlers);

      return () => runtime.stopStreaming();
    },
    cancelTask: async (taskId) => {
      const runtimeType = detectRuntime();
      if (runtimeType !== 'desktop') {
        const result = await cancelTask(taskId);
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        return;
      }

      const runtime = await loadDesktopStreamingRuntime();
      await runtime.cancelTask?.(taskId);
    },
  };
};
