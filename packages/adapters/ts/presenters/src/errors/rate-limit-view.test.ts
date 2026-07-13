import { describe, expect, it } from 'bun:test';

import { formatRateLimitCountdown, formatRateLimitResetDate } from './rate-limit-view';

describe('rate-limit view helpers', () => {
  const nowMs = Date.parse('2026-05-24T12:00:00.000Z');

  it('formats minute and second countdowns', () => {
    expect(formatRateLimitCountdown('2026-05-24T12:01:05.000Z', nowMs)).toBe('1m 5s');
  });

  it('formats second-only countdowns', () => {
    expect(formatRateLimitCountdown('2026-05-24T12:00:09.000Z', nowMs)).toBe('9s');
  });

  it('shows retry-ready state for expired reset times', () => {
    expect(formatRateLimitCountdown('2026-05-24T11:59:59.000Z', nowMs)).toBe('Ready to retry');
  });

  it('ignores invalid reset times', () => {
    expect(formatRateLimitCountdown('not-a-date', nowMs)).toBeNull();
    expect(formatRateLimitResetDate('not-a-date')).toBeNull();
  });

  it('formats valid reset dates for display', () => {
    expect(formatRateLimitResetDate('2026-05-24T12:01:05.000Z')).toEqual(expect.any(String));
  });
});
