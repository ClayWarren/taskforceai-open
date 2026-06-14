import { describe, expect, it } from 'bun:test';
import { isRetryableError } from './retry';

describe('isRetryableError', () => {
  describe('non-object errors', () => {
    it('returns false for null', () => {
      expect(isRetryableError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isRetryableError(undefined)).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isRetryableError('error')).toBe(false);
      expect(isRetryableError(123)).toBe(false);
      expect(isRetryableError(true)).toBe(false);
    });
  });

  describe('429 Rate Limiting', () => {
    it('returns true for 429 without reset time', () => {
      expect(isRetryableError({ status: 429 })).toBe(true);
    });

    it('returns delay for 429 with future reset time in body', () => {
      const resetTime = new Date(Date.now() + 30000);
      const result = isRetryableError({
        status: 429,
        body: { resetTime: resetTime.toISOString() },
      });
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(25000);
      expect(result).toBeLessThanOrEqual(30000);
    });

    it('returns delay for 429 with retry_after in body', () => {
      const resetTime = new Date(Date.now() + 45000);
      const result = isRetryableError({
        status: 429,
        body: { retry_after: resetTime.toISOString() },
      });
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(40000);
      expect(result).toBeLessThanOrEqual(45000);
    });

    it('treats numeric retry_after as seconds from now', () => {
      const result = isRetryableError({
        status: 429,
        body: { retry_after: 30 },
      });
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(29000);
      expect(result).toBeLessThanOrEqual(30000);
    });

    it('treats numeric string retry_after as seconds from now', () => {
      const result = isRetryableError({
        status: 429,
        body: { retry_after: '30' },
      });
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(29000);
      expect(result).toBeLessThanOrEqual(30000);
    });

    it('returns true for 429 with expired reset time', () => {
      const resetTime = new Date(Date.now() - 60000);
      const result = isRetryableError({
        status: 429,
        body: { resetTime: resetTime.toISOString() },
      });
      expect(result).toBe(true);
    });

    it('returns true for 429 with reset time > 1 minute', () => {
      const resetTime = new Date(Date.now() + 120000);
      const result = isRetryableError({
        status: 429,
        body: { resetTime: resetTime.toISOString() },
      });
      expect(result).toBe(true);
    });

    it('handles numeric resetTime', () => {
      const resetTime = Date.now() + 15000;
      const result = isRetryableError({ status: 429, body: { resetTime } });
      expect(result).toBeGreaterThan(14000);
      expect(result).toBeLessThanOrEqual(15000);
    });
  });

  describe('5xx Server Errors', () => {
    it('returns true for 500', () => {
      expect(isRetryableError({ status: 500 })).toBe(true);
    });

    it('returns true for 502', () => {
      expect(isRetryableError({ status: 502 })).toBe(true);
    });

    it('returns true for 503', () => {
      expect(isRetryableError({ status: 503 })).toBe(true);
    });

    it('returns true for 504', () => {
      expect(isRetryableError({ status: 504 })).toBe(true);
    });
  });

  describe('Network & Connectivity Issues', () => {
    it('returns true for network error in message', () => {
      expect(isRetryableError({ message: 'Network error occurred' })).toBe(true);
    });

    it('returns true for timeout in message', () => {
      expect(isRetryableError({ message: 'Request timeout' })).toBe(true);
    });

    it('returns true for temporarily in message', () => {
      expect(isRetryableError({ message: 'Service temporarily unavailable' })).toBe(true);
    });

    it('returns true for unavailable in message', () => {
      expect(isRetryableError({ message: 'Server unavailable' })).toBe(true);
    });

    it('returns true for abort in message', () => {
      expect(isRetryableError({ message: 'Request aborted' })).toBe(true);
    });

    it('returns true for fetch failed in message', () => {
      expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
    });

    it('returns true for connection in message', () => {
      expect(isRetryableError({ message: 'Connection refused' })).toBe(true);
    });

    it('returns true for socket in message', () => {
      expect(isRetryableError({ message: 'Socket hang up' })).toBe(true);
    });

    it('returns true for retryable keyword in name', () => {
      expect(isRetryableError({ name: 'TimeoutError' })).toBe(true);
    });

    it('is case-insensitive for message', () => {
      expect(isRetryableError({ message: 'NETWORK ERROR' })).toBe(true);
    });

    it('is case-insensitive for name', () => {
      expect(isRetryableError({ name: 'TIMEOUTERROR' })).toBe(true);
    });
  });

  describe('Non-retryable errors', () => {
    it('returns false for 400 Bad Request', () => {
      expect(isRetryableError({ status: 400 })).toBe(false);
    });

    it('returns false for 401 Unauthorized', () => {
      expect(isRetryableError({ status: 401 })).toBe(false);
    });

    it('returns false for 403 Forbidden', () => {
      expect(isRetryableError({ status: 403 })).toBe(false);
    });

    it('returns false for 404 Not Found', () => {
      expect(isRetryableError({ status: 404 })).toBe(false);
    });

    it('returns false for generic error without retryable indicators', () => {
      expect(isRetryableError({ message: 'Invalid input' })).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isRetryableError({})).toBe(false);
    });
  });
});
