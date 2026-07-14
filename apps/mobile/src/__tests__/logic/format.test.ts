/**
 * Format Utilities Tests - Test date and price formatting functions
 */
import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';

import {
  formatUnixDate,
  formatDate,
} from '../../utils/format';

describe('formatUnixDate', () => {
  it('formats a valid unix timestamp', () => {
    const result = formatUnixDate(1704067200);
    assert.ok(result.includes('2024'), 'Expected year 2024 in output');
  });

  it('returns N/A for null', () => {
    assert.strictEqual(formatUnixDate(null), 'N/A');
  });

  it('returns N/A for undefined', () => {
    assert.strictEqual(formatUnixDate(undefined as any), 'N/A');
  });

  it('returns N/A for zero', () => {
    assert.strictEqual(formatUnixDate(0), 'N/A');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDate('2024-01-01T00:00:00Z');
    assert.ok(result.includes('2024'), 'Expected year 2024 in output');
    assert.ok(result.includes('January'), 'Expected month name in output');
  });

  it('returns N/A for null', () => {
    assert.strictEqual(formatDate(null), 'N/A');
  });

  it('returns N/A for undefined', () => {
    assert.strictEqual(formatDate(undefined as any), 'N/A');
  });

  it('returns N/A for empty string', () => {
    assert.strictEqual(formatDate(''), 'N/A');
  });
});
