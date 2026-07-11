import { describe, expect, it, mock } from 'bun:test';

import {
  createFetchSseTaskStreamTransport,
  createSseMessageParser,
  isTerminalTaskStreamPayload,
  startTaskStream,
  type FetchLike,
  type TaskStreamMetricSink,
} from './task-stream-transport';

const streamFromChunks = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

const erroringStream = (chunks: string[], error: Error): ReadableStream<Uint8Array> =>
  new ReadableStream({
    pull(controller) {
      controller.error(error);
    },
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
    },
  });

const okResponse = (body: ReadableStream<Uint8Array>, status = 200): Response =>
  new Response(body, { status });

const createMetrics = (): TaskStreamMetricSink & {
  stopTimer: ReturnType<typeof mock>;
} => {
  const stopTimer = mock(() => {});
  return {
    stopTimer,
    incrementCounter: mock(() => {}),
    startTimer: mock(() => stopTimer),
  };
};

const drainAsyncWork = async () => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

describe('createSseMessageParser', () => {
  it('parses split chunks, comments, and multiline data frames', () => {
    const messages: string[] = [];
    const parser = createSseMessageParser((message) => messages.push(message));

    parser.push(': keep-alive\n');
    parser.push('event: progress\n');
    parser.push('data: first');
    parser.push('\ndata: second\r\n\r\n');
    parser.push('data: final\n\n');

    expect(messages).toEqual(['first\nsecond', 'final']);
  });

  it('flushes a final unterminated data frame', () => {
    const messages: string[] = [];
    const parser = createSseMessageParser((message) => messages.push(message));

    parser.push('data: final-without-newline');
    parser.flush();

    expect(messages).toEqual(['final-without-newline']);
  });
});

describe('createFetchSseTaskStreamTransport', () => {
  it('streams SSE messages through fetch and retries active read failures', async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    const fetchImpl = mock(async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? okResponse(erroringStream(['data: before-error\n\n'], new Error('network lost')))
        : okResponse(streamFromChunks(['data: after-retry\n\n']));
    }) as unknown as FetchLike;
    const transport = createFetchSseTaskStreamTransport({ fetchImpl, retryDelayMs: 0 });
    const messages: string[] = [];
    const recoverableErrors: unknown[] = [];

    await transport.connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-1',
      signal: controller.signal,
      onOpen: () => {},
      onMessage: (message) => {
        messages.push(message);
        if (message === 'after-retry') controller.abort();
      },
      onRecoverableError: (error) => recoverableErrors.push(error),
      onTerminalError: (error) => {
        throw error;
      },
      onClose: () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(messages).toEqual(['before-error', 'after-retry']);
    expect(recoverableErrors).toHaveLength(1);
  });

  it('retries a clean EOF until a terminal event is received', async () => {
    let fetchCalls = 0;
    const fetchImpl = mock(async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? okResponse(streamFromChunks(['data: {"type":"progress"}\n\n']))
        : okResponse(streamFromChunks(['data: {"type":"complete"}\n\n']));
    }) as unknown as FetchLike;
    const recoverable = mock(() => {});
    const close = mock(() => {});

    await createFetchSseTaskStreamTransport({ fetchImpl, retryDelayMs: 0 }).connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-clean-eof',
      signal: new AbortController().signal,
      onOpen: () => {},
      onMessage: () => {},
      onRecoverableError: recoverable,
      onTerminalError: (error) => {
        throw error;
      },
      onClose: close,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(recoverable).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ reason: 'closed' });
  });

  it('reports startup HTTP and missing-body failures as terminal errors', async () => {
    const errors: string[] = [];
    const close = mock(() => {});

    await createFetchSseTaskStreamTransport({
      fetchImpl: mock(async () => new Response(null, { status: 503 })) as unknown as FetchLike,
    }).connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-http',
      signal: new AbortController().signal,
      onOpen: () => {},
      onMessage: () => {},
      onRecoverableError: () => {},
      onTerminalError: (error) => errors.push(error instanceof Error ? error.message : 'unknown'),
      onClose: close,
    });

    await createFetchSseTaskStreamTransport({
      fetchImpl: mock(async () => new Response(null, { status: 200 })) as unknown as FetchLike,
    }).connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-body',
      signal: new AbortController().signal,
      onOpen: () => {},
      onMessage: () => {},
      onRecoverableError: () => {},
      onTerminalError: (error) => errors.push(error instanceof Error ? error.message : 'unknown'),
      onClose: close,
    });

    expect(errors).toEqual(['Streaming HTTP 503', 'Streaming response body unavailable']);
    expect(close).not.toHaveBeenCalled();
  });

  it('uses global fetch by default and reports when fetch is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const errors: string[] = [];

    try {
      Object.assign(globalThis, { fetch: undefined });
      await createFetchSseTaskStreamTransport().connect({
        url: 'https://engine.taskforceai.chat/api/v1/stream/task-no-fetch',
        signal: new AbortController().signal,
        onOpen: () => {},
        onMessage: () => {},
        onRecoverableError: () => {},
        onTerminalError: (error) => errors.push(error instanceof Error ? error.message : 'unknown'),
        onClose: () => {},
      });
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
    }

    expect(errors).toEqual(['fetch is not available for task streaming']);
  });

  it('reports aborted closes when fetch fails after abort', async () => {
    const controller = new AbortController();
    const close = mock(() => {});
    const terminal = mock(() => {});

    await createFetchSseTaskStreamTransport({
      fetchImpl: mock(async () => {
        controller.abort();
        throw new Error('cancelled');
      }) as unknown as FetchLike,
    }).connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-abort',
      signal: controller.signal,
      onOpen: () => {},
      onMessage: () => {},
      onRecoverableError: () => {},
      onTerminalError: terminal,
      onClose: close,
    });

    expect(terminal).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({ reason: 'aborted' });
  });

  it('stops retry backoff promptly when aborted after a recoverable error', async () => {
    const controller = new AbortController();
    const close = mock(() => {});
    const recoverable = mock(() => {
      queueMicrotask(() => controller.abort());
    });

    await createFetchSseTaskStreamTransport({
      fetchImpl: mock(async () =>
        okResponse(erroringStream(['data: before-abort\n\n'], new Error('network lost')))
      ) as unknown as FetchLike,
      retryDelayMs: 60_000,
    }).connect({
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-retry-abort',
      signal: controller.signal,
      onOpen: () => {},
      onMessage: () => {},
      onRecoverableError: recoverable,
      onTerminalError: (error) => {
        throw error;
      },
      onClose: close,
    });

    expect(recoverable).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ reason: 'aborted' });
  });
});

describe('isTerminalTaskStreamPayload', () => {
  it('detects complete and error payloads only', () => {
    expect(isTerminalTaskStreamPayload('{"type":"complete"}')).toBe(true);
    expect(isTerminalTaskStreamPayload('{"type":"error"}')).toBe(true);
    expect(isTerminalTaskStreamPayload('{"type":"progress"}')).toBe(false);
    expect(isTerminalTaskStreamPayload('not-json')).toBe(false);
  });
});

describe('startTaskStream', () => {
  it('rejects startup failures once and records startup metrics', async () => {
    const metrics = createMetrics();
    const error = new Error('offline');
    const handlers = {
      onError: mock(() => {}),
    };

    const startPromise = startTaskStream({
      taskId: 'task-startup-failure',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-startup-failure',
      controller: new AbortController(),
      transport: {
        connect: ({ onTerminalError }) => {
          onTerminalError(error);
        },
      },
      handlers,
      metrics,
      connectionFailedMessage: 'Streaming connection failed',
    });

    await expect(startPromise).rejects.toThrow('Streaming connection failed');
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.failure',
      expect.objectContaining({ phase: 'startup' })
    );
    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('resolves startup immediately when the controller is already aborted', async () => {
    const metrics = createMetrics();
    const controller = new AbortController();
    controller.abort();

    await expect(
      startTaskStream({
        taskId: 'task-already-aborted',
        url: 'https://engine.taskforceai.chat/api/v1/stream/task-already-aborted',
        controller,
        transport: { connect: () => {} },
        handlers: { onError: mock(() => {}) },
        metrics,
      })
    ).resolves.toBeUndefined();

    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('records open, message, empty-message, and closed lifecycle events', async () => {
    const metrics = createMetrics();
    const handlers = {
      onOpen: mock(() => {}),
      onMessage: mock(() => {}),
      onError: mock(() => {}),
    };
    const onMessageReceived = mock(() => {});
    const onConnectionLost = mock(() => {});

    await startTaskStream({
      taskId: 'task-open-close',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-open-close',
      controller: new AbortController(),
      transport: {
        connect: ({ onOpen, onMessage, onClose }) => {
          onOpen({ status: 202 });
          onMessage('');
          onMessage('payload');
          onClose({ reason: 'closed' });
        },
      },
      handlers,
      metrics,
      onMessageReceived,
      onConnectionLost,
    });

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith('payload');
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
    expect(onMessageReceived).toHaveBeenCalledWith('open');
    expect(onMessageReceived).toHaveBeenCalledWith('message');
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.opened',
      expect.objectContaining({ status: 202 })
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith('streaming.sse.connection.closed', {
      transport: 'sse',
    });
    expect(onConnectionLost).toHaveBeenCalledWith();
  });

  it('ignores recoverable errors after abort and records aborted closes', async () => {
    const metrics = createMetrics();
    const controller = new AbortController();
    const onConnectionLost = mock(() => {});

    await startTaskStream({
      taskId: 'task-recoverable-abort',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-recoverable-abort',
      controller,
      transport: {
        connect: ({ onOpen, onRecoverableError, onClose }) => {
          onOpen();
          controller.abort();
          onRecoverableError(new Error('lost after abort'));
          onClose({ reason: 'aborted' });
        },
      },
      handlers: {},
      metrics,
      onConnectionLost,
    });

    expect(onConnectionLost).not.toHaveBeenCalled();
    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'streaming.sse.connection.lost',
      expect.anything()
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith('streaming.sse.connection.aborted', {
      transport: 'sse',
    });
  });

  it('records active terminal transport errors after the stream opens', async () => {
    const metrics = createMetrics();
    const error = new Error('active failure');
    const handlers = {
      onError: mock(() => {}),
    };

    await startTaskStream({
      taskId: 'task-active-terminal',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-active-terminal',
      controller: new AbortController(),
      transport: {
        connect: ({ onOpen, onTerminalError }) => {
          onOpen();
          onTerminalError(error);
        },
      },
      handlers,
      metrics,
    });

    expect(handlers.onError).toHaveBeenCalledWith(error);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.failure',
      expect.objectContaining({ phase: 'active' })
    );
    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('ignores closed callbacks before opening and settles when aborted later', async () => {
    const metrics = createMetrics();
    const controller = new AbortController();

    await startTaskStream({
      taskId: 'task-close-before-open',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-close-before-open',
      controller,
      transport: {
        connect: ({ onClose }) => {
          onClose({ reason: 'closed' });
          controller.abort();
        },
      },
      handlers: {},
      metrics,
    });

    expect(metrics.incrementCounter).not.toHaveBeenCalledWith(
      'streaming.sse.connection.closed',
      expect.anything()
    );
    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('records aborted rejected transport promises', async () => {
    const metrics = createMetrics();
    const controller = new AbortController();

    await startTaskStream({
      taskId: 'task-reject-after-abort',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-reject-after-abort',
      controller,
      transport: {
        connect: () => {
          controller.abort();
          return Promise.reject(new Error('aborted rejection'));
        },
      },
      handlers: {},
      metrics,
    });
    await drainAsyncWork();

    expect(metrics.incrementCounter).toHaveBeenCalledWith('streaming.sse.connection.aborted', {
      transport: 'sse',
    });
  });

  it('rejects when the transport promise rejects before opening', async () => {
    const metrics = createMetrics();
    const error = new Error('connect rejected');
    const handlers = {
      onError: mock(() => {}),
    };

    await expect(
      startTaskStream({
        taskId: 'task-reject-before-open',
        url: 'https://engine.taskforceai.chat/api/v1/stream/task-reject-before-open',
        controller: new AbortController(),
        transport: {
          connect: () => Promise.reject(error),
        },
        handlers,
        metrics,
        connectionFailedMessage: 'startup rejected',
      })
    ).rejects.toThrow('startup rejected');

    expect(handlers.onError).toHaveBeenCalledWith(error);
    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('records active rejected transport promises after opening', async () => {
    const metrics = createMetrics();
    const error = new Error('active rejected');
    const handlers = {
      onError: mock(() => {}),
    };

    await startTaskStream({
      taskId: 'task-reject-after-open',
      url: 'https://engine.taskforceai.chat/api/v1/stream/task-reject-after-open',
      controller: new AbortController(),
      transport: {
        connect: ({ onOpen }) => {
          onOpen();
          return Promise.reject(error);
        },
      },
      handlers,
      metrics,
    });
    await drainAsyncWork();

    expect(handlers.onError).toHaveBeenCalledWith(error);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.failure',
      expect.objectContaining({ phase: 'active' })
    );
    expect(metrics.stopTimer).toHaveBeenCalledTimes(1);
  });
});
