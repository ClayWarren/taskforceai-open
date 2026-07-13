import { describe, expect, it, jest } from 'bun:test';

import { calculateTokenExpiry, isTokenExpired, isValidEmail } from './utils';

describe('shared/auth/utils', () => {
  describe('isValidEmail', () => {
    it('accepts a valid email address', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('rejects invalid email input', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
    });
  });

  describe('isTokenExpired', () => {
    it('returns false for future expiry time', () => {
      jest.useFakeTimers({ now: 1000000 });
      const futureTime = 1000000 + 10000; // 10 seconds from now
      expect(isTokenExpired(futureTime)).toBe(false);
      jest.useRealTimers();
    });

    it('returns true for past expiry time', () => {
      jest.useFakeTimers({ now: 1000000 });
      const pastTime = 1000000 - 10000; // 10 seconds ago
      expect(isTokenExpired(pastTime)).toBe(true);
      jest.useRealTimers();
    });

    it('returns true for current time (edge case)', () => {
      jest.useFakeTimers({ now: 1000000 });
      expect(isTokenExpired(1000000)).toBe(true);
      jest.useRealTimers();
    });

    it('handles very old tokens', () => {
      jest.useFakeTimers({ now: 100000000 });
      const veryOld = 100000000 - 86400000; // 1 day ago
      expect(isTokenExpired(veryOld)).toBe(true);
      jest.useRealTimers();
    });

    it('handles far future tokens', () => {
      jest.useFakeTimers({ now: 1000000 });
      const farFuture = 1000000 + 86400000; // 1 day from now
      expect(isTokenExpired(farFuture)).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('calculateTokenExpiry', () => {
    it('calculates expiry time correctly in seconds', () => {
      jest.useFakeTimers({ now: 1000000 });
      const expiresIn = 3600; // 1 hour in seconds
      const expiryTime = calculateTokenExpiry(expiresIn);

      expect(expiryTime).toBe(1000000 + expiresIn * 1000);
      jest.useRealTimers();
    });

    it('handles zero expiry', () => {
      jest.useFakeTimers({ now: 1000000 });
      const expiryTime = calculateTokenExpiry(0);

      expect(expiryTime).toBe(1000000);
      jest.useRealTimers();
    });

    it('handles short expiry times', () => {
      jest.useFakeTimers({ now: 1000000 });
      const expiresIn = 60; // 1 minute
      const expiryTime = calculateTokenExpiry(expiresIn);

      expect(expiryTime).toBe(1000000 + 60000);
      jest.useRealTimers();
    });

    it('handles long expiry times', () => {
      jest.useFakeTimers({ now: 1000000 });
      const expiresIn = 86400; // 24 hours
      const expiryTime = calculateTokenExpiry(expiresIn);

      expect(expiryTime).toBe(1000000 + 86400000);
      jest.useRealTimers();
    });

    it('converts seconds to milliseconds correctly', () => {
      jest.useFakeTimers({ now: 1000000 });
      const expiresIn = 1; // 1 second
      const expiryTime = calculateTokenExpiry(expiresIn);

      expect(expiryTime).toBe(1000000 + 1000);
      jest.useRealTimers();
    });
  });
});
