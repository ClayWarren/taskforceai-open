import { fetchEventSource } from '@microsoft/fetch-event-source';

import { webMetrics } from '../observability/metrics';
import type { StreamingRuntimeHandlers } from './platform-interfaces';

export interface CoreStreamingOptions {
  taskId: string;
  controller: AbortController;
  handlers: StreamingRuntimeHandlers;
  /** Error message used when the initial connection fails. */
  connectionFailedMessage?: string;
  /** Called on open and on each message (e.g. to reset a watchdog timer). */
  onMessageReceived?: (activity: 'open' | 'message') => void;
  /** Called when the connection drops after opening (e.g. to log a retry). */
  onConnectionLost?: () => void;
}

export const resolveStreamUrl = (
  taskId: string,
  rawApiUrl?: string,
  currentOrigin?: string
): string => {
  const streamPath = `/api/v1/stream/${taskId}`;
  const apiUrl = rawApiUrl?.trim();
  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    return streamPath;
  }

  if (currentOrigin) {
    try {
      const api = new URL(apiUrl);
      const current = new URL(currentOrigin);
      const directStreamOrigin = resolveTaskForceDirectStreamOrigin(api, current);
      if (directStreamOrigin) {
        return `${directStreamOrigin}${streamPath}`;
      }
      if (api.origin === current.origin) {
        return streamPath;
      }
    } catch {
      return streamPath;
    }
  }

  return `${apiUrl.replace(/\/+$/, '')}${streamPath}`;
};

const TASKFORCE_WEB_HOSTS = new Set(['taskforceai.chat', 'www.taskforceai.chat']);
const TASKFORCE_STREAM_ORIGIN = 'https://engine.taskforceai.chat';

const resolveTaskForceDirectStreamOrigin = (api: URL, current: URL): string | null => {
  if (api.protocol !== 'https:' || current.protocol !== 'https:') {
    return null;
  }

  const isTaskForceWeb =
    TASKFORCE_WEB_HOSTS.has(current.hostname) &&
    (api.hostname === 'taskforceai.chat' || api.hostname.endsWith('.taskforceai.chat'));

  return isTaskForceWeb ? TASKFORCE_STREAM_ORIGIN : null;
};

/**
 * Shared SSE lifecycle: builds the startup promise, wires fetchEventSource,
 * and normalises open/message/error/catch paths. Platform-specific behaviour
 * (watchdog, bridge wait) is injected via the options hooks.
 */
export function startCoreStreaming(opts: CoreStreamingOptions): Promise<void> {
  const {
    taskId,
    controller,
    handlers,
    connectionFailedMessage = 'Streaming connection failed',
    onMessageReceived,
    onConnectionLost,
  } = opts;

  let streamOpened = false;
  let startupSettled = false;
  let connectionFinished = false;
  let resolveStart: () => void = () => {};
  let rejectStart: (reason?: unknown) => void = () => {};
  const startPromise = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });

  const settleStartupOnAbort = () => {
    if (startupSettled || streamOpened) {
      return;
    }
    startupSettled = true;
    resolveStart();
  };

  if (controller.signal.aborted) {
    settleStartupOnAbort();
  } else {
    controller.signal.addEventListener('abort', settleStartupOnAbort, { once: true });
  }

  const failStartup = (error: unknown) => {
    if (startupSettled || streamOpened || controller.signal.aborted) {
      return;
    }
    startupSettled = true;
    controller.signal.removeEventListener('abort', settleStartupOnAbort);
    webMetrics.incrementCounter('streaming.sse.connection.failure', {
      transport: 'sse',
      phase: 'startup',
      error: error instanceof Error ? error.name : 'unknown',
    });
    handlers.onError?.(error);
    rejectStart(new Error(connectionFailedMessage));
  };

  const streamUrl = resolveStreamUrl(
    taskId,
    import.meta.env['VITE_API_URL'],
    typeof window !== 'undefined' ? window.location.origin : undefined
  );
  const metricTags = { transport: 'sse' };
  webMetrics.incrementCounter('streaming.sse.connection.total', metricTags);
  const stopConnectionTimer = webMetrics.startTimer(
    'streaming.sse.connection.duration',
    metricTags
  );
  const finishConnection = () => {
    if (connectionFinished) {
      return;
    }
    connectionFinished = true;
    stopConnectionTimer();
  };

  void fetchEventSource(streamUrl, {
    signal: controller.signal,
    credentials: 'include',
    openWhenHidden: true,
    onopen: async (response) => {
      if (!response.ok) {
        throw new Error(`Streaming HTTP ${response.status}`);
      }
      streamOpened = true;
      startupSettled = true;
      controller.signal.removeEventListener('abort', settleStartupOnAbort);
      webMetrics.incrementCounter('streaming.sse.connection.opened', {
        ...metricTags,
        status: response.status,
      });
      handlers.onOpen?.();
      onMessageReceived?.('open');
      resolveStart();
    },
    onmessage: (event) => {
      onMessageReceived?.('message');
      if (event.data) {
        webMetrics.incrementCounter('streaming.sse.message.received', metricTags);
        handlers.onMessage?.(event.data);
      }
    },
    onclose: () => {
      finishConnection();
      if (controller.signal.aborted || !streamOpened) {
        return;
      }
      webMetrics.incrementCounter('streaming.sse.connection.closed', metricTags);
      onConnectionLost?.();
    },
    onerror: (error) => {
      if (controller.signal.aborted) {
        return;
      }
      if (!streamOpened) {
        failStartup(error);
        throw error;
      }
      webMetrics.incrementCounter('streaming.sse.connection.lost', metricTags);
      onConnectionLost?.();
    },
  })
    .then(() => {
      if (controller.signal.aborted) {
        webMetrics.incrementCounter('streaming.sse.connection.aborted', metricTags);
      }
      finishConnection();
    })
    .catch((error) => {
      if (controller.signal.aborted) {
        webMetrics.incrementCounter('streaming.sse.connection.aborted', metricTags);
        finishConnection();
        return;
      }
      if (!streamOpened) {
        failStartup(error);
        finishConnection();
        return;
      }
      webMetrics.incrementCounter('streaming.sse.connection.failure', {
        ...metricTags,
        phase: 'active',
        error: error instanceof Error ? error.name : 'unknown',
      });
      handlers.onError?.(error);
      finishConnection();
    });

  return startPromise;
}
