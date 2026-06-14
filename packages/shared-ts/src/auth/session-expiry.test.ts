import { afterEach, describe, expect, it } from 'bun:test';

import { getJwtExpiryMs, resolveSessionExpiryMs } from './session-expiry';

const createToken = (payload: Record<string, unknown>): string => {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${encodedPayload}.signature`;
};

describe('session expiry helpers', () => {
  const originalAtob = globalThis.atob;
  const originalBuffer = (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer;

  afterEach(() => {
    Object.defineProperty(globalThis, 'atob', {
      value: originalAtob,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Buffer', {
      value: originalBuffer,
      configurable: true,
      writable: true,
    });
  });

  it('reads numeric jwt exp claims in milliseconds', () => {
    expect(getJwtExpiryMs(createToken({ exp: 10 }))).toBe(10_000);
  });

  it('reads string jwt exp claims in milliseconds', () => {
    expect(getJwtExpiryMs(createToken({ exp: '12.5' }))).toBe(12_500);
  });

  it('ignores malformed tokens and invalid exp claims', () => {
    expect(getJwtExpiryMs('invalid')).toBeNull();
    expect(getJwtExpiryMs('header.not-json.signature')).toBeNull();
    expect(getJwtExpiryMs('header..signature')).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: -1 }))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: 'soon' }))).toBeNull();
  });

  it('falls back to Buffer decoding when atob is unavailable', () => {
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(getJwtExpiryMs(createToken({ exp: 15 }))).toBe(15_000);
  });

  it('returns null when no base64 decoder is available', () => {
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Buffer', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(getJwtExpiryMs(createToken({ exp: 15 }))).toBeNull();
  });

  it('prefers jwt expiry, then fallback expiry, then default ttl', () => {
    expect(resolveSessionExpiryMs(createToken({ exp: 10 }), 20, 1_000)).toBe(10_000);
    expect(resolveSessionExpiryMs('invalid', 20, 1_000)).toBe(20);
    expect(resolveSessionExpiryMs('invalid', -1, 1_000)).toBe(2_592_001_000);
  });
});
