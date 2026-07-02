import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const fetchEventSourceMock = vi.fn();
const webMetricsStopTimer = vi.fn();
const webMetricsMock = {
  incrementCounter: vi.fn(),
  startTimer: vi.fn(() => webMetricsStopTimer),
};

mock.module('@microsoft/fetch-event-source', () => ({
  fetchEventSource: fetchEventSourceMock,
}));

mock.module('../observability/metrics', () => ({
  webMetrics: webMetricsMock,
}));

const { startCoreStreaming } = await import('./streaming-core');

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
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      options.onmessage({ data: 'chunk-1' });
      options.onmessage({ data: '' });
    });

    await startCoreStreaming({
      taskId: 'task-1',
      controller,
      handlers,
      onMessageReceived,
    });

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
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 503 }));
    });

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

  it('reports connection loss after the stream has opened', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    const onConnectionLost = vi.fn();
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      options.onerror(new Error('temporary drop'));
      throw new Error('final drop');
    });

    await startCoreStreaming({
      taskId: 'task-3',
      controller,
      handlers,
      onConnectionLost,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onConnectionLost).toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith('streaming.sse.connection.lost', {
      transport: 'sse',
    });
    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.failure',
      expect.objectContaining({ phase: 'active', transport: 'sse' })
    );
  });

  it('records duration and reports a clean close after the stream has opened', async () => {
    const controller = new AbortController();
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn(),
    };
    const onConnectionLost = vi.fn();
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      options.onclose();
    });

    await startCoreStreaming({
      taskId: 'task-clean-close',
      controller,
      handlers,
      onConnectionLost,
    });
    await Promise.resolve();

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
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      await options.onopen(new Response(null, { status: 200 }));
      controller.abort();
    });

    await startCoreStreaming({
      taskId: 'task-abort-resolve',
      controller,
      handlers,
    });
    await Promise.resolve();

    expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
      'streaming.sse.connection.aborted',
      {
        transport: 'sse',
      }
    );
    expect(webMetricsStopTimer).toHaveBeenCalledTimes(1);
  });

  it('settles startup without reporting errors when aborted before open', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    fetchEventSourceMock.mockImplementation(async (_url, options) => {
      controller.abort();
      options.onerror(new Error('aborted'));
      throw new Error('aborted catch');
    });

    const startPromise = startCoreStreaming({
      taskId: 'task-4',
      controller,
      handlers,
    });

    await Promise.resolve();
    await expect(startPromise).resolves.toBeUndefined();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('settles startup when the signal is already aborted', async () => {
    const controller = new AbortController();
    const handlers = {
      onError: vi.fn(),
    };
    controller.abort();
    fetchEventSourceMock.mockImplementation(async () => {});

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
