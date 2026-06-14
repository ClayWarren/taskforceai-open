import { describe, expect, it } from 'bun:test';

import { formatISODate, formatRelativeTime, formatTime } from './time';

describe('utils/time', () => {
  describe('formatTime', () => {
    it('formats seconds less than 60', () => {
      expect(formatTime(30)).toBe('30S');
      expect(formatTime(0)).toBe('0S');
      expect(formatTime(59)).toBe('59S');
    });

    it('formats seconds as minutes and seconds', () => {
      expect(formatTime(60)).toBe('1M0S');
      expect(formatTime(90)).toBe('1M30S');
      expect(formatTime(3599)).toBe('59M59S');
    });

    it('formats seconds as hours and minutes', () => {
      expect(formatTime(3600)).toBe('1H0M');
      expect(formatTime(3660)).toBe('1H1M');
      expect(formatTime(7200)).toBe('2H0M');
    });

    it('handles fractional seconds', () => {
      expect(formatTime(30.5)).toBe('30S');
      expect(formatTime(90.9)).toBe('1M30S');
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "just now" for recent timestamps', () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe('just now');
    });

    it('formats minutes ago', () => {
      const minuteAgo = new Date(Date.now() - 60 * 1000);
      expect(formatRelativeTime(minuteAgo)).toBe('1 minute ago');

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      expect(formatRelativeTime(twoMinutesAgo)).toBe('2 minutes ago');
    });

    it('formats hours ago', () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      expect(formatRelativeTime(hourAgo)).toBe('1 hour ago');

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('2 hours ago');
    });

    it('formats days ago', () => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(dayAgo)).toBe('1 day ago');

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoDaysAgo)).toBe('2 days ago');
    });

    it('formats future timestamps', () => {
      const oneMinuteFromNow = new Date(Date.now() + 61 * 1000);
      expect(formatRelativeTime(oneMinuteFromNow)).toBe('1 minute from now');

      const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000 + 1000);
      expect(formatRelativeTime(twoHoursFromNow)).toBe('2 hours from now');
    });

    it('handles invalid date', () => {
      expect(formatRelativeTime('invalid')).toBe('Invalid date');
      expect(formatRelativeTime(NaN)).toBe('Invalid date');
    });

    it('accepts timestamp as number', () => {
      const now = Date.now();
      expect(formatRelativeTime(now)).toBe('just now');
    });

    it('accepts timestamp as string', () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe('just now');
    });
  });

  describe('formatISODate', () => {
    it('formats a date as ISO string', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      expect(formatISODate(date)).toBe('2024-01-15T12:00:00.000Z');
    });

    it('uses current date when no argument provided', () => {
      const result = formatISODate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
