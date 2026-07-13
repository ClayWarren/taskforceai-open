import { describe, expect, it } from 'bun:test';

import { parseEnabledFlag, parseSampleRate } from './env-parsing';

describe('env parsing helpers', () => {
  it('parses enabled flags', () => {
    expect(parseEnabledFlag('1')).toBe(true);
    expect(parseEnabledFlag('true')).toBe(true);
    expect(parseEnabledFlag('YES')).toBe(true);
    expect(parseEnabledFlag('on')).toBe(true);
    expect(parseEnabledFlag('0')).toBe(false);
    expect(parseEnabledFlag(undefined)).toBe(false);
  });

  it('parses bounded sample rates with fallback', () => {
    expect(parseSampleRate('0.25', 0)).toBe(0.25);
    expect(parseSampleRate('1', 0)).toBe(1);
    expect(parseSampleRate('bad', 0.5)).toBe(0.5);
    expect(parseSampleRate('-1', 0.5)).toBe(0.5);
    expect(parseSampleRate('1.1', 0.5)).toBe(0.5);
    expect(parseSampleRate(undefined, 0.5)).toBe(0.5);
  });
});
