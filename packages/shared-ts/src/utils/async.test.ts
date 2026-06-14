import { describe, expect, it, vi } from 'bun:test';

import { debounce, retry, sleep, throttle, trackPromise } from './async';

describe('utils/async', () => {
  it('sleeps for at least the requested delay', async () => {
    const startedAt = Date.now();
    await sleep(1);
    expect(Date.now()).toBeGreaterThanOrEqual(startedAt);
  });

  it('retries failed work and logs retry attempts', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const fn = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce('ok');

    await expect(retry(fn, { retries: 1, delay: 0, logger, label: 'job' })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and rethrows after retry exhaustion', async () => {
    const error = new Error('still failing');
    const logger = { warn: vi.fn(), error: vi.fn() };
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retry(fn, { retries: 0, logger, label: 'job' })).rejects.toThrow('still failing');
    expect(logger.error).toHaveBeenCalledWith('job failed after 1 attempts', {
      error,
      attempts: 1,
    });
  });

  it('debounces calls until the wait window elapses', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 1);

    debounced('first');
    debounced('second');
    await sleep(5);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('throttles calls until the limit window elapses', async () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 1);

    throttled('first');
    throttled('second');
    await sleep(5);
    throttled('third');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'first');
    expect(fn).toHaveBeenNthCalledWith(2, 'third');
  });

  it('tracks rejected promises through the provided logger', async () => {
    const logger = { error: vi.fn() };
    const error = new Error('background failure');

    trackPromise(Promise.reject(error), { logger, label: 'background task' });
    await sleep(1);

    expect(logger.error).toHaveBeenCalledWith('background task failed', { error });
  });
});
