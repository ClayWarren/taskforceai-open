import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

type CoreStreamingOptions = {
  taskId: string;
  controller: AbortController;
  handlers: {
    onOpen?: () => void;
    onMessage?: (payload: string) => void;
    onError?: (error: unknown) => void;
  };
  onMessageReceived?: (activity: 'open' | 'message') => void;
  onConnectionLost?: () => void;
};

let latestOptions: CoreStreamingOptions | null = null;
let resolveStream: (() => void) | null = null;
let rejectStream: ((reason?: unknown) => void) | null = null;
const webMetricsMock = {
  incrementCounter: vi.fn(),
  startTimer: vi.fn(() => vi.fn()),
};
const loggerDebugMock = vi.fn();

const mockStartCoreStreaming = mock((options: CoreStreamingOptions) => {
  latestOptions = options;
  return new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
    options.controller.signal.addEventListener('abort', () => resolve(), { once: true });
  });
});

mock.module('../streaming-core', () => ({
  startCoreStreaming: mockStartCoreStreaming,
}));

mock.module('../../observability/metrics', () => ({
  webMetrics: webMetricsMock,
}));

mock.module('../../logger', () => ({
  logger: { debug: loggerDebugMock, warn: vi.fn() },
}));

const loadRuntime = async () => {
  const module = await import('./streaming-runtime');
  return module.createBrowserStreamingRuntime();
};

const getOptions = (): CoreStreamingOptions => {
  if (!latestOptions) {
    throw new Error('Expected startCoreStreaming to be called');
  }
  return latestOptions;
};

const openCurrentStream = async () => {
  const options = getOptions();
  options.handlers.onOpen?.();
  options.onMessageReceived?.('open');
  resolveStream?.();
};

const sendCurrentMessage = (data: string) => {
  const options = getOptions();
  options.onMessageReceived?.('message');
  options.handlers.onMessage?.(data);
};

const failCurrentStartup = (error: unknown) => {
  const options = getOptions();
  options.handlers.onError?.(error);
  rejectStream?.(new Error('Streaming connection failed'));
};

beforeEach(() => {
  latestOptions = null;
  resolveStream = null;
  rejectStream = null;
  mockStartCoreStreaming.mockClear();
  webMetricsMock.incrementCounter.mockClear();
  webMetricsMock.startTimer.mockClear();
  loggerDebugMock.mockClear();
});

describe('BrowserStreamingRuntime', () => {
  const createHandlers = () => ({
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onError: vi.fn(),
  });

  it('resolves on open and forwards messages', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-1', handlers);

    await openCurrentStream();
    await startPromise;
    sendCurrentMessage('payload');
    getOptions().onConnectionLost?.();

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith('payload');
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(loggerDebugMock).toHaveBeenCalledWith(
      '[BrowserStreamingRuntime] SSE connection lost, retrying...'
    );
  });

  it('rejects when the connection fails before opening', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-2', handlers);

    failCurrentStartup(new Error('startup failed'));

    await expect(startPromise).rejects.toThrow('Streaming connection failed');
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it('aborts stream on stop', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-4', handlers);
    const options = getOptions();
    await openCurrentStream();
    await startPromise;

    runtime.stopStreaming();
    expect(options.controller.signal.aborted).toBe(true);
  });

  it('reconnects instead of failing at the first watchdog threshold', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await loadRuntime();
      const handlers = createHandlers();

      const startPromise = runtime.startStreaming('task-watchdog', handlers);
      const options = getOptions();
      await openCurrentStream();
      await startPromise;
      const firstSignal = options.controller.signal;

      vi.advanceTimersByTime(120_000);
      expect(handlers.onError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(59_000);
      expect(handlers.onError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1_000);
      expect(handlers.onError).not.toHaveBeenCalled();
      expect(mockStartCoreStreaming).toHaveBeenCalledTimes(2);
      expect(firstSignal?.aborted).toBe(true);
      expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
        'streaming.sse.watchdog.timeout',
        expect.objectContaining({ outcome: 'reconnect', attempt: 1 })
      );

      const reconnectedOptions = getOptions();
      await openCurrentStream();
      sendCurrentMessage('after-reconnect');

      expect(handlers.onOpen).toHaveBeenCalledTimes(2);
      expect(handlers.onMessage).toHaveBeenCalledWith('after-reconnect');
      expect(reconnectedOptions.taskId).toBe('task-watchdog');
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles startup when the watchdog reconnects before the first open', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await loadRuntime();
      const handlers = createHandlers();

      const startPromise = runtime.startStreaming('task-watchdog-startup', handlers);
      const firstSignal = getOptions().controller.signal;

      vi.advanceTimersByTime(180_000);
      await expect(startPromise).resolves.toBeUndefined();

      expect(firstSignal?.aborted).toBe(true);
      expect(mockStartCoreStreaming).toHaveBeenCalledTimes(2);
      expect(handlers.onError).not.toHaveBeenCalled();

      await openCurrentStream();
      expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an error after repeated watchdog reconnects go stale', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await loadRuntime();
      const handlers = createHandlers();

      const startPromise = runtime.startStreaming('task-watchdog-fail', handlers);
      await openCurrentStream();
      await startPromise;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.advanceTimersByTime(180_000);
        expect(handlers.onError).not.toHaveBeenCalled();
        await openCurrentStream();
      }

      vi.advanceTimersByTime(180_000);
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(mockStartCoreStreaming).toHaveBeenCalledTimes(4);
      expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
        'streaming.sse.watchdog.timeout',
        expect.objectContaining({ outcome: 'failed', attempt: 4 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('replenishes the watchdog reconnect budget after stream data arrives', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await loadRuntime();
      const handlers = createHandlers();

      const startPromise = runtime.startStreaming('task-watchdog-recovers', handlers);
      await openCurrentStream();
      await startPromise;

      vi.advanceTimersByTime(180_000);
      await openCurrentStream();
      sendCurrentMessage('healthy-after-reconnect');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.advanceTimersByTime(180_000);
        expect(handlers.onError).not.toHaveBeenCalled();
        await openCurrentStream();
      }

      expect(handlers.onError).not.toHaveBeenCalled();
      expect(mockStartCoreStreaming).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
