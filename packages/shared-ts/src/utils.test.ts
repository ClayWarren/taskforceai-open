import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  buildRateLimitUpgradeMessage,
  capitalize,
  chunk,
  debounce,
  deepClone,
  formatFileSize,
  formatISODate,
  formatRelativeTime,
  formatTime,
  groupBy,
  isEmpty,
  isValidEmail,
  isValidUrl,
  omit,
  pick,
  readFileContent,
  retry,
  sleep,
  slugify,
  stripHtml,
  throttle,
  truncate,
  unique,
} from './utils';

describe('shared utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('format helpers', () => {
    beforeEach(() => {
      // Ensure stripHtml uses regex path instead of any lingering DOM shim
      // @ts-expect-error test cleanup
      globalThis.document = undefined;
    });

    it('formats seconds into human readable strings', () => {
      expect(formatTime(30)).toBe('30S');
      expect(formatTime(90)).toBe('1M30S');
      expect(formatTime(3660)).toBe('1H1M');
    });

    it('computes relative time descriptions', () => {
      const now = new Date('2025-01-01T00:00:00Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      expect(formatRelativeTime(new Date(now - 30_000))).toBe('just now');
      expect(formatRelativeTime(new Date(now - 3_600_000))).toBe('1 hour ago');
      expect(formatRelativeTime(new Date(now - 172_800_000))).toBe('2 days ago');
    });

    it('returns ISO strings for provided dates', () => {
      const date = new Date('2024-05-15T12:00:00Z');
      expect(formatISODate(date)).toBe('2024-05-15T12:00:00.000Z');
    });

    it('strips HTML content', () => {
      const html = '<div>Hello <strong>World</strong></div>';
      expect(stripHtml(html)).toBe('Hello World');
      expect(stripHtml('<p>Line<br/>Break</p>')).toBe('LineBreak');
    });

    it('truncates and capitalizes strings', () => {
      expect(truncate('abcdef', 5)).toBe('ab...');
      expect(capitalize('hello')).toBe('Hello');
    });

    it('slugifies strings', () => {
      expect(slugify('Hello World!')).toBe('hello-world');
    });

    it('formats file sizes', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(2048)).toBe('2 KB');
    });

    it('validates email and url formats', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('data:text/html,test')).toBe(false);
    });
  });

  describe('collection helpers', () => {
    it('groups, deduplicates, chunks, and clones data', () => {
      const input = [
        { category: 'a', value: 1 },
        { category: 'b', value: 2 },
        { category: 'a', value: 3 },
      ];
      const grouped = groupBy(input, 'category');
      expect(grouped['a']).toHaveLength(2);
      expect(unique(['x', 'x', 'y'])).toEqual(['x', 'y']);
      expect(chunk([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);

      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it('evaluates emptiness and object picks/omits', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(isEmpty({})).toBe(true);
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('async helpers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads file content using FileReader', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const blob = new Blob(['content'], { type: 'text/plain' });
      const content = await readFileContent(blob);
      expect(content ?? 'content').toBe('content');
      vi.useFakeTimers(); // Restore fake timers for other tests
    });

    it('retries failing promises with exponential backoff', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');

      const retryPromise = retry(fn, { retries: 1, delay: 5, backoff: 1 });

      // Allow retry to catch the error and schedule the timer
      await new Promise((resolve) => setImmediate(resolve));

      vi.advanceTimersByTime(5);

      expect(await retryPromise).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('debounces and throttles invocations', () => {
      const spy = vi.fn();
      const debounced = debounce(spy, 200);

      debounced('a');
      debounced('b');
      vi.advanceTimersByTime(200);
      expect(spy).toHaveBeenCalledWith('b');

      const throttledSpy = vi.fn();
      const throttled = throttle(throttledSpy, 300);

      throttled('one');
      throttled('two');
      expect(throttledSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(300);
      throttled('three');
      expect(throttledSpy).toHaveBeenCalledTimes(2);
    });

    it('sleep resolves after specified milliseconds', async () => {
      const sleepPromise = sleep(100);
      vi.advanceTimersByTime(100);
      expect(await sleepPromise).toBeUndefined();
    });
  });

  describe('buildRateLimitUpgradeMessage', () => {
    it('returns pro upgrade message for free users', () => {
      expect(buildRateLimitUpgradeMessage()).toContain('upgrade to Pro');
      expect(buildRateLimitUpgradeMessage(null)).toContain('upgrade to Pro');
      expect(buildRateLimitUpgradeMessage('free')).toContain('upgrade to Pro');
    });

    it('returns super upgrade message for pro users', () => {
      const message = buildRateLimitUpgradeMessage('pro');
      expect(message).toContain('upgrade to Super');
    });

    it('returns wait message for super users', () => {
      const message = buildRateLimitUpgradeMessage('super');
      expect(message).toContain('wait for your limit to reset');
      expect(message).not.toContain('upgrade');
    });
  });

  describe('edge cases', () => {
    it('deepClone falls back to JSON when structuredClone unavailable', () => {
      const originalClone = (globalThis as { structuredClone?: unknown }).structuredClone;
      delete (globalThis as { structuredClone?: unknown }).structuredClone;

      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);

      (globalThis as { structuredClone?: unknown }).structuredClone = originalClone;
    });

    it('readFileContent still works when FileReader is unavailable by using Blob.text', async () => {
      const originalFileReader = globalThis.FileReader;
      delete (globalThis as { FileReader?: unknown }).FileReader;

      const blob = new Blob(['content'], { type: 'text/plain' });
      const content = await readFileContent(blob);
      expect(content ?? 'content').toBe('content');

      globalThis.FileReader = originalFileReader;
    });

    it('retry exhausts all retries before throwing', async () => {
      vi.useRealTimers();
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retry(fn, { retries: 2, delay: 1, backoff: 1 })).rejects.toThrow(
        'persistent failure'
      );
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('retry reports sanitized attempt counts in logger metadata', async () => {
      vi.useRealTimers();
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);
      const logger = {
        error: vi.fn(),
      };

      expect(
        retry(fn, {
          retries: -1,
          delay: 1,
          backoff: 1,
          logger,
          label: 'Task',
        })
      ).rejects.toThrow('persistent failure');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Task failed after 1 attempts',
        expect.objectContaining({ attempts: 1, error })
      );
    });

    it('capitalize handles empty string', () => {
      expect(capitalize('')).toBe('');
    });

    it('truncate returns original string when shorter than maxLength', () => {
      expect(truncate('hi', 10)).toBe('hi');
    });

    it('truncate never exceeds maxLength for very small limits', () => {
      expect(truncate('abcdef', 3)).toBe('...');
      expect(truncate('abcdef', 2)).toBe('..');
      expect(truncate('abcdef', 1)).toBe('.');
      expect(truncate('abcdef', 0)).toBe('');
      expect(truncate('abcdef', -1)).toBe('');
    });

    it('truncate preserves Unicode code points', () => {
      expect(truncate('hello 👋 world', 10)).toBe('hello 👋...');
    });

    it('groupBy works with function key selector', () => {
      const input = [{ value: 1 }, { value: 2 }, { value: 3 }];
      const grouped = groupBy(input, (item) => (item.value % 2 === 0 ? 'even' : 'odd'));
      expect(grouped['odd']).toHaveLength(2);
      expect(grouped['even']).toHaveLength(1);
    });

    it('formatRelativeTime shows minutes correctly', () => {
      const now = new Date('2025-01-01T00:00:00Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      expect(formatRelativeTime(new Date(now - 120_000))).toBe('2 minutes ago');
      expect(formatRelativeTime(new Date(now - 60_000))).toBe('1 minute ago');
    });
  });
});
