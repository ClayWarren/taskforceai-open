import { describe, expect, it } from 'bun:test';

import { normalizeDeviceLoginCode, stripDeviceLoginCode } from './device-login';

describe('device login helpers', () => {
  it('normalizes and strips device login codes', () => {
    expect(normalizeDeviceLoginCode('abcd-1234')).toBe('ABCD-1234');
    expect(normalizeDeviceLoginCode('ab cd 12 34')).toBe('ABCD-1234');
    expect(normalizeDeviceLoginCode('ABCDEFGH1234')).toBe('ABCD-EFGH');
    expect(stripDeviceLoginCode('ab cd-1234')).toBe('ABCD1234');
  });
});
