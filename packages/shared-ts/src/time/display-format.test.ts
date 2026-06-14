import { describe, expect, it } from 'bun:test';

import {
  formatCurrencyFromMinorUnits,
  formatDisplaySource,
  formatLongDateOrFallback,
  formatMessageDate,
  formatMessageTime,
  formatRecentDayLabel,
  formatRelativeSyncTime,
} from './display-format';

describe('time display formatters', () => {
  it('formats message timestamps and ignores invalid values', () => {
    expect(formatMessageTime('2024-01-01T10:30:00.000Z', 'en-US')).toMatch(/\d{1,2}:\d{2}/);
    expect(formatMessageDate('2024-06-15T00:00:00.000Z', 'en-US')).toContain('2024');
    expect(formatMessageTime('invalid', 'en-US')).toBe('');
    expect(formatMessageDate(NaN, 'en-US')).toBe('');
  });

  it('formats long dates with fallback support', () => {
    expect(formatLongDateOrFallback(1_704_067_200, { unixSeconds: true })).toContain('2024');
    expect(formatLongDateOrFallback('2024-06-15T12:00:00Z')).toContain('June');
    expect(formatLongDateOrFallback(null)).toBe('N/A');
    expect(formatLongDateOrFallback('')).toBe('N/A');
  });

  it('formats source and price labels', () => {
    expect(formatDisplaySource('stripe')).toBe('Stripe');
    expect(formatDisplaySource(null)).toBe('N/A');
    expect(formatCurrencyFromMinorUnits(1999)).toBe('$19.99');
  });

  it('formats recent day labels', () => {
    const now = Date.parse('2026-05-24T12:00:00.000Z');
    expect(formatRecentDayLabel(now, now)).toBe('Today');
    expect(formatRecentDayLabel(now - 86_400_000, now)).toBe('Yesterday');
    expect(formatRecentDayLabel(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(formatRecentDayLabel(now - 10 * 86_400_000, now, 'en-US')).toMatch(/\w{3} \d+/);
  });

  it('formats relative sync time', () => {
    const now = Date.parse('2026-05-24T12:00:00.000Z');
    expect(formatRelativeSyncTime(now - 10_000, now)).toBe('Just now');
    expect(formatRelativeSyncTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeSyncTime(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatRelativeSyncTime(now - 2 * 86_400_000, now)).toEqual(expect.any(String));
  });
});
