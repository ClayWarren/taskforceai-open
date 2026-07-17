import { StreamingStoreAdapter } from '@taskforceai/react-core';
import { detectRuntime } from '@taskforceai/browser-runtime/runtime';
import { definedProps } from '@taskforceai/client-core/utils/object';
import { cancelTask } from '@taskforceai/api-client/api/tasks';
import { createBrowserStreamingRuntime } from '../platform/browser/streaming-runtime';
import { StreamingRuntime, StreamingRuntimeHandlers } from '../platform/platform-interfaces';
import { logger } from '../logger';
import { reportOptionalLatencyMark } from '../observability/latency';
import { createDesktopStreamingRuntime } from '../platform/desktop-api';

let desktopStreamingRuntimePromise: Promise<StreamingRuntime> | null = null;
const loadDesktopStreamingRuntime = async (): Promise<StreamingRuntime> => {
  if (!desktopStreamingRuntimePromise) {
    desktopStreamingRuntimePromise = Promise.resolve(createDesktopStreamingRuntime());
  }
  return desktopStreamingRuntimePromise;
};

export const createWebStreamingAdapter = (): StreamingStoreAdapter => {
  return {
    debug: import.meta.env?.VITE_STREAMING_DEBUG === '1',
    logger,
    reportLatencyMark: reportOptionalLatencyMark,
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
