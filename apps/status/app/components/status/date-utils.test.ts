import { describe, expect, it } from 'bun:test';

import { parseStatusDate } from './date-utils';

describe('parseStatusDate', () => {
  it('parses date-only values and timestamps without timezone as UTC', () => {
    expect(parseStatusDate('2026-03-04')?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
    expect(parseStatusDate('2026-03-04T12:30')?.toISOString()).toBe('2026-03-04T12:30:00.000Z');
    expect(parseStatusDate('2026-03-04T12:30:15.123456789')?.toISOString()).toBe(
      '2026-03-04T12:30:15.123Z'
    );
  });

  it('rejects invalid calendar dates before native Date normalization can roll them over', () => {
    expect(parseStatusDate('2026-02-29')).toBeNull();
    expect(parseStatusDate('2026-02-31T12:00:00Z')).toBeNull();
    expect(parseStatusDate('2026-13-01')).toBeNull();
    expect(parseStatusDate('2026-00-01')).toBeNull();
    expect(parseStatusDate('2026-01-00')).toBeNull();
  });

  it('falls back to native timestamp parsing for valid timezone-aware values', () => {
    expect(parseStatusDate('2026-03-04T12:30:00-05:00')?.toISOString()).toBe(
      '2026-03-04T17:30:00.000Z'
    );
    expect(parseStatusDate('not-a-date')).toBeNull();
  });
});
