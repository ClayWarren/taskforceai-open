import { describe, expect, it } from 'bun:test';

import { normalizeDeviceLoginCode, stripDeviceLoginCode } from './device-login-code';

describe('device-login-code', () => {
  it('normalizes codes with separators and lowercase input', () => {
    expect(normalizeDeviceLoginCode('abcd-1234')).toBe('ABCD-1234');
    expect(normalizeDeviceLoginCode('ab cd 12 34')).toBe('ABCD-1234');
  });

  it('truncates codes longer than eight alphanumeric characters', () => {
    expect(normalizeDeviceLoginCode('ABCDEFGH1234')).toBe('ABCD-EFGH');
  });

  it('strips non-alphanumeric characters for submission', () => {
    expect(stripDeviceLoginCode('ABCD-1234')).toBe('ABCD1234');
  });
});
