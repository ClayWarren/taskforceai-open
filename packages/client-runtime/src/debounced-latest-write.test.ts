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
    const promise = new Promise<void>((resolve) => {
      resolveDeferred = resolve;
    });

    return {
      promise,
      resolve() {
        if (!resolveDeferred) {
          throw new Error('Expected deferred resolver');
        }
        resolveDeferred();
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
});
