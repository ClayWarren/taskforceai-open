import { fetchEventSource } from '@microsoft/fetch-event-source';
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
  if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
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
    handlers.onError?.(error);
    rejectStart(new Error(connectionFailedMessage));
  };

  const streamUrl = resolveStreamUrl(
    taskId,
    import.meta.env['VITE_API_URL'],
    typeof window !== 'undefined' ? window.location.origin : undefined
  );

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
      handlers.onOpen?.();
      onMessageReceived?.('open');
      resolveStart();
    },
    onmessage: (event) => {
      onMessageReceived?.('message');
      if (event.data) {
        handlers.onMessage?.(event.data);
      }
    },
    onerror: (error) => {
      if (controller.signal.aborted) {
        return;
      }
      if (!streamOpened) {
        failStartup(error);
        throw error;
      }
      onConnectionLost?.();
    },
  }).catch((error) => {
    if (controller.signal.aborted) {
      return;
    }
    if (!streamOpened) {
      failStartup(error);
      return;
    }
    handlers.onError?.(error);
  });

  return startPromise;
}
