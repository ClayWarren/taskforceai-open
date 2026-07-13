import { describe, expect, it } from 'bun:test';

import { formatIncidentDateUtc, formatIncidentTimestampUtc } from './IncidentHistory';
import { formatUptimeDate } from './UptimeBar';

describe('status date formatting', () => {
  it('keeps uptime day labels stable for date-only values', () => {
    expect(formatUptimeDate('2026-02-27', 'en-US')).toBe('Feb 27, 2026');
  });

  it('formats incident date headings in UTC', () => {
    expect(
      formatIncidentDateUtc(
        '2026-03-01T00:30:00Z',
        { month: 'long', day: 'numeric', year: 'numeric' },
        'en-US'
      )
    ).toBe('March 1, 2026');
  });

  it('formats incident timestamps in UTC to match UTC label', () => {
    expect(formatIncidentTimestampUtc('2026-03-01T00:30:00Z', 'en-US')).toBe('Mar 1, 00:30');
  });

  it('treats timezone-less incident timestamps as UTC', () => {
    expect(
      formatIncidentDateUtc('2026-03-01T00:30:00', { month: 'long', day: 'numeric' }, 'en-US')
    ).toBe('March 1');
    expect(formatIncidentTimestampUtc('2026-03-01T00:30:00', 'en-US')).toBe('Mar 1, 00:30');
  });

  it('returns Invalid Date for malformed values', () => {
    expect(formatUptimeDate('bad-date', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('bad-date', 'en-US')).toBe('Invalid Date');
  });

  it('returns Invalid Date for impossible date-only values', () => {
    expect(formatUptimeDate('2026-02-32', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('2026-02-32', 'en-US')).toBe('Invalid Date');
    expect(formatUptimeDate('2026-02-29', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('2026-02-29', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('2026-02-29T00:30:00', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('2026-02-29T00:30:00Z', 'en-US')).toBe('Invalid Date');
    expect(formatUptimeDate('2026-13-01', 'en-US')).toBe('Invalid Date');
    expect(formatIncidentTimestampUtc('2026-00-10', 'en-US')).toBe('Invalid Date');
  });
});
