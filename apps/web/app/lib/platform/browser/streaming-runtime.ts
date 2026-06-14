import type { StreamingRuntime, StreamingRuntimeHandlers } from '../platform-interfaces';
import { startCoreStreaming } from '../streaming-core';
import { logger } from '../../logger';

// Engine sends keep-alive pulses while a task is quiet. If the browser misses
// those pulses, restart SSE and let the stream endpoint replay current state.
const STALE_STREAM_TIMEOUT_MS = 180_000;
const MAX_WATCHDOG_RECONNECTS = 3;

class BrowserStreamingRuntime implements StreamingRuntime {
  private streamAbortController: AbortController | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogReconnects = 0;

  async startStreaming(taskId: string, handlers: StreamingRuntimeHandlers): Promise<void> {
    this.stopStreaming();
    this.watchdogReconnects = 0;
    return this.connect(taskId, handlers);
  }

  private connect(taskId: string, handlers: StreamingRuntimeHandlers): Promise<void> {
    this.abortCurrentConnection();

    const controller = new AbortController();
    this.streamAbortController = controller;

    const resetWatchdog = (activity: 'open' | 'message') => {
      if (controller.signal.aborted) {
        return;
      }
      if (activity === 'message') {
        this.watchdogReconnects = 0;
      }
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
      }
      this.watchdogTimer = setTimeout(() => {
        this.handleWatchdogTimeout(taskId, handlers, controller);
      }, STALE_STREAM_TIMEOUT_MS);
    };

    resetWatchdog('open');

    return startCoreStreaming({
      taskId,
      controller,
      handlers,
      onMessageReceived: resetWatchdog,
      onConnectionLost: () => {
        if (typeof logger.debug === 'function') {
          logger.debug('[BrowserStreamingRuntime] SSE connection lost, retrying...');
        }
      },
    });
  }

  private handleWatchdogTimeout(
    taskId: string,
    handlers: StreamingRuntimeHandlers,
    controller: AbortController
  ): void {
    if (controller.signal.aborted || controller !== this.streamAbortController) {
      return;
    }

    this.watchdogReconnects += 1;
    if (this.watchdogReconnects <= MAX_WATCHDOG_RECONNECTS) {
      logger.warn('[BrowserStreamingRuntime] SSE watchdog timeout; reconnecting', {
        reconnectAttempt: this.watchdogReconnects,
        maxReconnectAttempts: MAX_WATCHDOG_RECONNECTS,
      });
      void this.connect(taskId, handlers).catch((error) => handlers.onError?.(error));
      return;
    }

    logger.warn('[BrowserStreamingRuntime] SSE watchdog timeout');
    handlers.onError?.(new Error('Connection timed out (watchdog)'));
    this.stopStreaming();
  }

  private abortCurrentConnection(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
  }

  stopStreaming(): void {
    this.abortCurrentConnection();
  }
}

export const createBrowserStreamingRuntime = (): StreamingRuntime => {
  return new BrowserStreamingRuntime();
};
