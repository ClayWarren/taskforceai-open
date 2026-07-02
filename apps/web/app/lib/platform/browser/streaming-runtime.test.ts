import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

type FetchEventSourceOptions = {
  signal?: AbortSignal;
  onopen?: (response: Response) => Promise<void> | void;
  onmessage?: (event: { data: string }) => void;
  onerror?: (error: unknown) => unknown;
};

let latestOptions: FetchEventSourceOptions | null = null;
let rejectStream: ((reason?: unknown) => void) | null = null;
const webMetricsMock = {
  incrementCounter: vi.fn(),
  startTimer: vi.fn(() => vi.fn()),
};

const mockFetchEventSource = mock((_: string, options: FetchEventSourceOptions) => {
  latestOptions = options;
  return new Promise<void>((_resolve, reject) => {
    rejectStream = reject;
  });
});

mock.module('@microsoft/fetch-event-source', () => ({
  fetchEventSource: mockFetchEventSource,
}));

mock.module('../../observability/metrics', () => ({
  webMetrics: webMetricsMock,
}));

const loadRuntime = async () => {
  const module = await import('./streaming-runtime');
  return module.createBrowserStreamingRuntime();
};

const getOptions = (): FetchEventSourceOptions => {
  if (!latestOptions) {
    throw new Error('Expected fetchEventSource to be called');
  }
  return latestOptions;
};

beforeEach(() => {
  latestOptions = null;
  rejectStream = null;
  mockFetchEventSource.mockClear();
  webMetricsMock.incrementCounter.mockClear();
  webMetricsMock.startTimer.mockClear();
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
    const options = getOptions();

    await options.onopen?.(new Response('', { status: 200 }));
    await startPromise;
    options.onmessage?.({ data: 'payload' });

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith('payload');
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('rejects when the connection fails before opening', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-2', handlers);
    const reject = rejectStream;
    if (!reject) {
      throw new Error('Expected stream reject function');
    }

    reject(new Error('startup failed'));

    await expect(startPromise).rejects.toThrow('Streaming connection failed');
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it('reports startup failure only once when onerror cascades to fetch rejection', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-2b', handlers);
    const options = getOptions();
    const reject = rejectStream;
    if (!reject) {
      throw new Error('Expected stream reject function');
    }

    try {
      options.onerror?.(new Error('startup failed'));
    } catch {
      // Expected: runtime throws inside onerror to make fetchEventSource stop retrying startup.
    }
    reject(new Error('startup failed'));

    await expect(startPromise).rejects.toThrow('Streaming connection failed');
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it('ignores reconnecting errors after stream opens', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-3', handlers);
    const options = getOptions();

    await options.onopen?.(new Response('', { status: 200 }));
    await startPromise;
    options.onerror?.(new Error('transient'));

    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('aborts stream on stop', async () => {
    const runtime = await loadRuntime();
    const handlers = createHandlers();

    const startPromise = runtime.startStreaming('task-4', handlers);
    const options = getOptions();
    await options.onopen?.(new Response('', { status: 200 }));
    await startPromise;

    runtime.stopStreaming();
    expect(options.signal?.aborted).toBe(true);
  });

  it('reconnects instead of failing at the first watchdog threshold', async () => {
    vi.useFakeTimers();
    try {
      const runtime = await loadRuntime();
      const handlers = createHandlers();

      const startPromise = runtime.startStreaming('task-watchdog', handlers);
      const options = getOptions();
      await options.onopen?.(new Response('', { status: 200 }));
      await startPromise;
      const firstSignal = options.signal;

      vi.advanceTimersByTime(120_000);
      expect(handlers.onError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(59_000);
      expect(handlers.onError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1_000);
      expect(handlers.onError).not.toHaveBeenCalled();
      expect(mockFetchEventSource).toHaveBeenCalledTimes(2);
      expect(firstSignal?.aborted).toBe(true);
      expect(webMetricsMock.incrementCounter).toHaveBeenCalledWith(
        'streaming.sse.watchdog.timeout',
        expect.objectContaining({ outcome: 'reconnect', attempt: 1 })
      );

      const reconnectedOptions = getOptions();
      await reconnectedOptions.onopen?.(new Response('', { status: 200 }));
      reconnectedOptions.onmessage?.({ data: 'after-reconnect' });

      expect(handlers.onOpen).toHaveBeenCalledTimes(2);
      expect(handlers.onMessage).toHaveBeenCalledWith('after-reconnect');
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
      const firstSignal = getOptions().signal;

      vi.advanceTimersByTime(180_000);
      await expect(startPromise).resolves.toBeUndefined();

      expect(firstSignal?.aborted).toBe(true);
      expect(mockFetchEventSource).toHaveBeenCalledTimes(2);
      expect(handlers.onError).not.toHaveBeenCalled();

      await getOptions().onopen?.(new Response('', { status: 200 }));
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
      await getOptions().onopen?.(new Response('', { status: 200 }));
      await startPromise;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.advanceTimersByTime(180_000);
        expect(handlers.onError).not.toHaveBeenCalled();
        await getOptions().onopen?.(new Response('', { status: 200 }));
      }

      vi.advanceTimersByTime(180_000);
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(mockFetchEventSource).toHaveBeenCalledTimes(4);
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
      await getOptions().onopen?.(new Response('', { status: 200 }));
      await startPromise;

      vi.advanceTimersByTime(180_000);
      await getOptions().onopen?.(new Response('', { status: 200 }));
      getOptions().onmessage?.({ data: 'healthy-after-reconnect' });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.advanceTimersByTime(180_000);
        expect(handlers.onError).not.toHaveBeenCalled();
        await getOptions().onopen?.(new Response('', { status: 200 }));
      }

      expect(handlers.onError).not.toHaveBeenCalled();
      expect(mockFetchEventSource).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
