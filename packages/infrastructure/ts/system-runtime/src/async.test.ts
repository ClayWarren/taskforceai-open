import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { debounce, retry, sleep, throttle, trackPromise } from './async';

describe('system runtime async helpers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries failing promises with exponential backoff', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
    const result = retry(operation, { retries: 1, delay: 5, backoff: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    vi.advanceTimersByTime(5);
    expect(await result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('debounces and throttles invocations', () => {
    const debouncedTarget = vi.fn();
    const debounced = debounce(debouncedTarget, 200);
    debounced('a');
    debounced('b');
    vi.advanceTimersByTime(200);
    expect(debouncedTarget).toHaveBeenCalledWith('b');

    const throttledTarget = vi.fn();
    const throttled = throttle(throttledTarget, 300);
    throttled('one');
    throttled('two');
    expect(throttledTarget).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    throttled('three');
    expect(throttledTarget).toHaveBeenCalledTimes(2);
  });

  it('sleeps and reports exhausted retries', async () => {
    const pendingSleep = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(pendingSleep).resolves.toBeUndefined();

    vi.useRealTimers();
    const error = new Error('persistent failure');
    const operation = vi.fn().mockRejectedValue(error);
    const logger = { error: vi.fn() };
    await expect(
      retry(operation, { retries: -1, delay: 1, backoff: 1, logger, label: 'Task' })
    ).rejects.toThrow('persistent failure');
    expect(logger.error).toHaveBeenCalledWith(
      'Task failed after 1 attempts',
      expect.objectContaining({ attempts: 1, error })
    );
  });

  it('reports rejected background promises through the provided logger', async () => {
    vi.useRealTimers();
    const logger = { error: vi.fn() };
    const error = new Error('background failure');

    trackPromise(Promise.reject(error), { logger, label: 'background task' });
    await sleep(1);

    expect(logger.error).toHaveBeenCalledWith('background task failed', { error });
  });
});
