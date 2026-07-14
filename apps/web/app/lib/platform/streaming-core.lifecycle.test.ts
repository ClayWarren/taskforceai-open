import { afterAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const webMetricsStopTimer = vi.fn();
const webMetricsMock = {
  incrementCounter: vi.fn(),
  startTimer: vi.fn(() => webMetricsStopTimer),
};

mock.module('../observability/metrics', () => ({
  webMetrics: webMetricsMock,
}));

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

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { startCoreStreaming } = await import('./streaming-core');

const drainAsyncWork = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('startCoreStreaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webMetricsStopTimer.mockClear();
  });

  it('resolves startup on open and forwards messages', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
    };
    const onMessageReceived = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(streamFromChunks(['data: chunk-1\n\n', 'data: \n\n']), { status: 200 })
    );

    await startCoreStreaming({
      taskId: 'task-1',
      controller,
      handlers,
      onMessageReceived,
    });
    await drainAsyncWork();

    expect(handlers.onOpen).toHaveBeenCalled();
    expect(handlers.onMessage).toHaveBeenCalledWith('chunk-1');
    expect(onMessageReceived).toHaveBeenCalledTimes(3);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.opened',
      expect.objectContaining({ status: 200, transport: 'sse' })
    );
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith('streaming.sse.message.received', {
      transport: 'sse',
    });
  });

  it('rejects startup failures before the stream opens', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      startCoreStreaming({
        taskId: 'task-2',
        controller,
        handlers,
        connectionFailedMessage: 'Could not connect',
      })
    ).rejects.toThrow('Could not connect');

    expect(handlers.onError).toHaveBeenCalled();
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.failure',
      expect.objectContaining({ phase: 'startup', transport: 'sse' })
    );
    expect(webMetricsStopTimer).toHaveBeenCalledTimes(1);
  });

  it('records duration and reports a clean close after the stream has opened', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    const onConnectionLost = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(streamFromChunks(['data: {"type":"complete"}\n\n']), { status: 200 })
    );

    await startCoreStreaming({
      taskId: 'task-clean-close',
      controller,
      handlers,
      onConnectionLost,
    });
    await drainAsyncWork();

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.closed',
      {
        transport: 'sse',
      }
    );
    expect(webMetricsStopTimer).toHaveBeenCalledTimes(1);
  });

  it('records duration when the stream resolves after abort', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return new Response(streamFromChunks([]), { status: 200 });
    });

    await startCoreStreaming({
      taskId: 'task-abort-resolve',
      controller,
      handlers,
    });
    await drainAsyncWork();

    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.aborted',
      {
        transport: 'sse',
      }
    );
    expect(webMetricsStopTimer).toHaveBeenCalledTimes(1);
  });

  it('settles startup when the signal is already aborted', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    controller.abort();
    fetchMock.mockResolvedValue(new Response(streamFromChunks([]), { status: 200 }));

    await expect(
      startCoreStreaming({
        taskId: 'task-5',
        controller,
        handlers,
      })
    ).resolves.toBeUndefined();

    expect(handlers.onError).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
