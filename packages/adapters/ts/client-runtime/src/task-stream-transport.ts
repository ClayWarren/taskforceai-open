export interface TaskStreamMetricSink {
  incrementCounter: (name: string, tags?: Record<string, string | number | boolean>) => void;
  startTimer: (name: string, tags?: Record<string, string | number | boolean>) => () => void;
}

export interface TaskStreamHandlers {
  onOpen?: () => void;
  onMessage?: (payload: string) => void;
  onError?: (error: unknown) => void;
}

export interface TaskStreamTransportOpenInfo {
  status?: number;
}

export interface TaskStreamTransportCloseInfo {
  reason: 'closed' | 'aborted';
}

export interface TaskStreamTransportOptions {
  url: string;
  signal: AbortSignal;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  onOpen: (info?: TaskStreamTransportOpenInfo) => void;
  onMessage: (data: string) => void;
  onRecoverableError: (error: unknown) => void;
  onTerminalError: (error: unknown) => void;
  onClose: (info: TaskStreamTransportCloseInfo) => void;
}

export interface TaskStreamTransport {
  connect: (options: TaskStreamTransportOptions) => void | Promise<void>;
}

export interface StartTaskStreamOptions {
  taskId: string;
  url: string;
  controller: AbortController;
  transport: TaskStreamTransport;
  handlers: TaskStreamHandlers;
  metrics: TaskStreamMetricSink;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  connectionFailedMessage?: string;
  onMessageReceived?: (activity: 'open' | 'message') => void;
  onConnectionLost?: (error?: unknown) => void;
}

export interface SseMessageParser {
  push: (chunk: string) => void;
  flush: () => void;
}

export type FetchLike = (
  input: string,
  init: {
    signal: AbortSignal;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    cache?: RequestCache;
  }
) => Promise<Response>;

const DEFAULT_FETCH_RETRY_DELAY_MS = 1_000;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      resolve();
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

const dispatchSseData = (dataLines: string[], onMessage: (data: string) => void) => {
  if (dataLines.length === 0) {
    return;
  }
  onMessage(dataLines.join('\n'));
  dataLines.length = 0;
};

export const createSseMessageParser = (onMessage: (data: string) => void): SseMessageParser => {
  let buffer = '';
  const dataLines: string[] = [];

  const processLine = (line: string) => {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (normalizedLine === '') {
      dispatchSseData(dataLines, onMessage);
      return;
    }
    if (normalizedLine.startsWith(':')) {
      return;
    }

    const colonIndex = normalizedLine.indexOf(':');
    const field = colonIndex === -1 ? normalizedLine : normalizedLine.slice(0, colonIndex);
    const rawValue = colonIndex === -1 ? '' : normalizedLine.slice(colonIndex + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'data') {
      dataLines.push(value);
    }
  };

  return {
    push: (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    },
    flush: () => {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
      dispatchSseData(dataLines, onMessage);
    },
  };
};

const readSseBody = async (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onMessage: (data: string) => void
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseMessageParser(onMessage);

  try {
    while (!signal.aborted) {
      // oxlint-disable-next-line no-await-in-loop -- SSE frames must be read and parsed in wire order.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        parser.push(decoder.decode(value, { stream: true }));
      }
    }
    parser.push(decoder.decode());
    parser.flush();
  } finally {
    reader.releaseLock();
  }
};

export const createFetchSseTaskStreamTransport = (options?: {
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
}): TaskStreamTransport => {
  const fetchImpl =
    options?.fetchImpl ??
    ((input, init) => {
      if (typeof globalThis.fetch !== 'function') {
        throw new Error('fetch is not available for task streaming');
      }
      return globalThis.fetch(input, init);
    });
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_FETCH_RETRY_DELAY_MS;

  return {
    connect: async ({
      url,
      signal,
      credentials,
      headers,
      onOpen,
      onMessage,
      onRecoverableError,
      onTerminalError,
      onClose,
    }) => {
      let openedOnce = false;
      let terminalMessageSeen = false;

      while (!signal.aborted) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- Reconnect attempts must stay sequential for one stream.
          const response = await fetchImpl(url, {
            signal,
            headers,
            credentials,
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(`Streaming HTTP ${response.status}`);
          }
          if (!response.body) {
            throw new Error('Streaming response body unavailable');
          }

          openedOnce = true;
          onOpen({ status: response.status });
          // oxlint-disable-next-line no-await-in-loop -- A stream body must finish before reconnecting.
          await readSseBody(response.body, signal, (data) => {
            terminalMessageSeen = terminalMessageSeen || isTerminalTaskStreamPayload(data);
            onMessage(data);
          });
          if (signal.aborted) {
            onClose({ reason: 'aborted' });
            return;
          }
          if (terminalMessageSeen) {
            onClose({ reason: 'closed' });
            return;
          }
          onRecoverableError(new Error('Streaming connection closed before terminal event'));
          // oxlint-disable-next-line no-await-in-loop -- Retry backoff is intentionally sequential.
          await sleep(retryDelayMs, signal);
        } catch (error) {
          if (signal.aborted) {
            onClose({ reason: 'aborted' });
            return;
          }
          if (!openedOnce) {
            onTerminalError(error);
            return;
          }
          onRecoverableError(error);
          // oxlint-disable-next-line no-await-in-loop -- Retry backoff is intentionally sequential.
          await sleep(retryDelayMs, signal);
        }
      }

      onClose({ reason: 'aborted' });
    },
  };
};

export const isTerminalTaskStreamPayload = (data: string): boolean => {
  try {
    const payload = JSON.parse(data) as { type?: unknown };
    return payload.type === 'complete' || payload.type === 'error';
  } catch {
    return false;
  }
};

export function startTaskStream(opts: StartTaskStreamOptions): Promise<void> {
  const {
    url,
    controller,
    transport,
    handlers,
    metrics,
    credentials,
    headers,
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

  const metricTags = { transport: 'sse' };
  metrics.incrementCounter('streaming.sse.connection.total', metricTags);
  const stopConnectionTimer = metrics.startTimer('streaming.sse.connection.duration', metricTags);

  const finishConnection = () => {
    if (connectionFinished) {
      return;
    }
    connectionFinished = true;
    stopConnectionTimer();
  };

  const settleStartupOnAbort = () => {
    if (startupSettled || streamOpened) {
      return;
    }
    startupSettled = true;
    finishConnection();
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
    metrics.incrementCounter('streaming.sse.connection.failure', {
      ...metricTags,
      phase: 'startup',
      error: error instanceof Error ? error.name : 'unknown',
    });
    handlers.onError?.(error);
    rejectStart(new Error(connectionFailedMessage));
  };

  void Promise.resolve(
    transport.connect({
      url,
      signal: controller.signal,
      credentials,
      headers,
      onOpen: (info) => {
        streamOpened = true;
        if (!startupSettled) {
          startupSettled = true;
          controller.signal.removeEventListener('abort', settleStartupOnAbort);
          resolveStart();
        }
        metrics.incrementCounter('streaming.sse.connection.opened', {
          ...metricTags,
          ...(typeof info?.status === 'number' ? { status: info.status } : {}),
        });
        handlers.onOpen?.();
        onMessageReceived?.('open');
      },
      onMessage: (data) => {
        onMessageReceived?.('message');
        if (!data) {
          return;
        }
        metrics.incrementCounter('streaming.sse.message.received', metricTags);
        handlers.onMessage?.(data);
      },
      onRecoverableError: (error) => {
        if (controller.signal.aborted) {
          return;
        }
        metrics.incrementCounter('streaming.sse.connection.lost', metricTags);
        onConnectionLost?.(error);
      },
      onTerminalError: (error) => {
        if (controller.signal.aborted) {
          return;
        }
        if (!streamOpened) {
          failStartup(error);
          finishConnection();
          return;
        }
        metrics.incrementCounter('streaming.sse.connection.failure', {
          ...metricTags,
          phase: 'active',
          error: error instanceof Error ? error.name : 'unknown',
        });
        handlers.onError?.(error);
        finishConnection();
      },
      onClose: (info) => {
        finishConnection();
        if (controller.signal.aborted || info.reason === 'aborted') {
          metrics.incrementCounter('streaming.sse.connection.aborted', metricTags);
          return;
        }
        if (!streamOpened) {
          return;
        }
        metrics.incrementCounter('streaming.sse.connection.closed', metricTags);
        onConnectionLost?.();
      },
    })
  ).catch((error) => {
    if (controller.signal.aborted) {
      metrics.incrementCounter('streaming.sse.connection.aborted', metricTags);
      finishConnection();
      return;
    }
    if (!streamOpened) {
      failStartup(error);
      finishConnection();
      return;
    }
    metrics.incrementCounter('streaming.sse.connection.failure', {
      ...metricTags,
      phase: 'active',
      error: error instanceof Error ? error.name : 'unknown',
    });
    handlers.onError?.(error);
    finishConnection();
  });

  return startPromise;
}
