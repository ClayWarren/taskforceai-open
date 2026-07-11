import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { createDebouncedLatestWriteQueue } from './debounced-latest-write';

describe('createDebouncedLatestWriteQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createDeferred = () => {
    let resolveDeferred: (() => void) | null = null;
    let rejectDeferred: ((error: unknown) => void) | null = null;
    const promise = new Promise<void>((resolve, reject) => {
      resolveDeferred = resolve;
      rejectDeferred = reject;
    });

    return {
      promise,
      resolve() {
        if (!resolveDeferred) {
          throw new Error('Expected deferred resolver');
        }
        resolveDeferred();
      },
      reject(error: unknown) {
        if (!rejectDeferred) {
          throw new Error('Expected deferred rejecter');
        }
        rejectDeferred(error);
      },
    };
  };

  it('debounces writes and persists only the latest queued payload', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');

    vi.advanceTimersByTime(499);
    expect(persist).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('third');
  });

  it('ignores stale scheduled timeout callbacks after a newer write is queued', async () => {
    vi.useRealTimers();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduledCallbacks: Array<() => void> = [];
    const timeoutIds: object[] = [];
    const persist = vi.fn(async (_payload: string) => {});

    globalThis.setTimeout = ((callback: TimerHandler) => {
      scheduledCallbacks.push(callback as () => void);
      const timeoutId = {};
      timeoutIds.push(timeoutId);
      return timeoutId as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = vi.fn() as typeof clearTimeout;

    try {
      const queue = createDebouncedLatestWriteQueue({
        debounceMs: 500,
        persist,
      });

      queue.enqueue('first');
      queue.enqueue('second');

      expect(globalThis.clearTimeout).toHaveBeenCalledWith(timeoutIds[0]);

      scheduledCallbacks[0]?.();
      await Promise.resolve();
      expect(persist).not.toHaveBeenCalled();

      scheduledCallbacks[1]?.();
      await Promise.resolve();
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith('second');
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('serializes writes and flushes the newest queued payload after an in-flight write finishes', async () => {
    const firstWrite = createDeferred();
    const persist = vi.fn((payload: string) => {
      if (payload === 'first') {
        return firstWrite.promise;
      }
      return Promise.resolve();
    });
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('first');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledWith('first');

    queue.enqueue('second');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).not.toHaveBeenCalledWith('second');

    firstWrite.resolve();
    await Promise.resolve();

    expect(persist).toHaveBeenCalledWith('second');
  });

  it('flushes a write enqueued by the active persist callback before completing', async () => {
    let queue: ReturnType<typeof createDebouncedLatestWriteQueue<string>>;
    const persist = vi.fn(async (payload: string) => {
      if (payload === 'first') {
        queue.enqueue('second');
      }
    });
    queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('first');
    await queue.flushNow();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenNthCalledWith(1, 'first');
    expect(persist).toHaveBeenNthCalledWith(2, 'second');
  });

  it('cancels queued writes when disposed during an in-flight flush', async () => {
    const firstWrite = createDeferred();
    const persist = vi.fn((payload: string) => {
      if (payload === 'stale') {
        return firstWrite.promise;
      }
      return Promise.resolve();
    });
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('stale');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledWith('stale');

    queue.enqueue('new');
    queue.dispose();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    firstWrite.resolve();
    await Promise.resolve();

    expect(persist).not.toHaveBeenCalledWith('new');
  });

  it('flushes pending writes immediately', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('now');
    await queue.flushNow();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('now');
  });

  it('treats flushNow on an empty live queue as a no-op', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    await queue.flushNow();

    expect(persist).not.toHaveBeenCalled();
  });

  it('flushNow joins an active flush and persists the newest pending payload', async () => {
    const firstWrite = createDeferred();
    const persist = vi.fn((payload: string) => {
      if (payload === 'first') {
        return firstWrite.promise;
      }
      return Promise.resolve();
    });
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('first');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledWith('first');

    queue.enqueue('second');
    queue.enqueue('third');
    const flushPromise = queue.flushNow();

    await Promise.resolve();
    expect(persist).not.toHaveBeenCalledWith('third');

    firstWrite.resolve();
    await flushPromise;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalledWith('second');
    expect(persist).toHaveBeenLastCalledWith('third');
  });

  it('flushNow joins an active flush without replaying when no pending payload exists', async () => {
    const firstWrite = createDeferred();
    const persist = vi.fn(() => firstWrite.promise);
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('only');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledWith('only');

    const flushPromise = queue.flushNow();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await flushPromise;

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('treats flushNow after disposal as a no-op', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('stale');
    queue.dispose();
    await queue.flushNow();

    expect(persist).not.toHaveBeenCalled();
  });

  it('reports persist errors and keeps accepting later writes', async () => {
    const writeError = new Error('write failed');
    const onError = vi.fn();
    const persist = vi.fn().mockRejectedValueOnce(writeError).mockResolvedValueOnce(undefined);
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
      onError,
    });

    queue.enqueue('bad');
    await queue.flushNow();
    queue.enqueue('good');
    await queue.flushNow();

    expect(onError).toHaveBeenCalledWith(writeError);
    expect(persist).toHaveBeenCalledWith('good');
  });

  it('suppresses persist errors from writes that reject after disposal', async () => {
    const firstWrite = createDeferred();
    const writeError = new Error('disposed write failed');
    const onError = vi.fn();
    const persist = vi.fn(() => firstWrite.promise);
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
      onError,
    });

    queue.enqueue('stale');
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(persist).toHaveBeenCalledWith('stale');

    queue.dispose();
    firstWrite.reject(writeError);
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores enqueue after dispose and stale scheduled flushes', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('stale');
    queue.dispose();
    queue.enqueue('ignored');
    vi.advanceTimersByTime(500);
    await queue.flushNow();

    expect(persist).not.toHaveBeenCalled();
  });

  it('allows dispose to be called repeatedly after clearing a scheduled write', async () => {
    const persist = vi.fn(async (_payload: string) => {});
    const queue = createDebouncedLatestWriteQueue({
      debounceMs: 500,
      persist,
    });

    queue.enqueue('stale');
    queue.dispose();
    queue.dispose();
    vi.advanceTimersByTime(500);
    await queue.flushNow();

    expect(persist).not.toHaveBeenCalled();
  });
});
