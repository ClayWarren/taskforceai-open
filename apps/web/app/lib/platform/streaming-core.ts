import { createFetchSseTaskStreamTransport, startTaskStream } from '@taskforceai/client-runtime';

import { webMetrics } from '../observability/metrics';
import type { StreamingRuntimeHandlers } from './platform-interfaces';

const fetchSseTransport = createFetchSseTaskStreamTransport();

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
 * Shared SSE lifecycle: builds the startup promise, wires the fetch transport,
 * and normalises open/message/error paths. Platform-specific behaviour
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

  const streamUrl = resolveStreamUrl(
    taskId,
    import.meta.env['VITE_API_URL'],
    typeof window !== 'undefined' ? window.location.origin : undefined
  );

  return startTaskStream({
    taskId,
    url: streamUrl,
    controller,
    transport: fetchSseTransport,
    handlers,
    metrics: webMetrics,
    credentials: 'include',
    connectionFailedMessage,
    onMessageReceived,
    onConnectionLost,
  });
}
