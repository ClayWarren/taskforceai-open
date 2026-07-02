import { afterEach, describe, expect, it } from 'bun:test';

import { getJwtExpiryMs, resolveSessionExpiryMs } from './session-expiry';

const createToken = (payload: unknown): string => {
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
    expect(getJwtExpiryMs('')).toBeNull();
    expect(getJwtExpiryMs('invalid')).toBeNull();
    expect(getJwtExpiryMs('header.not-json.signature')).toBeNull();
    expect(getJwtExpiryMs('header..signature')).toBeNull();
    expect(getJwtExpiryMs(createToken(null))).toBeNull();
    expect(getJwtExpiryMs(createToken('not-an-object'))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: 0 }))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: -1 }))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: Number.POSITIVE_INFINITY }))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: 'soon' }))).toBeNull();
    expect(getJwtExpiryMs(createToken({ exp: '9'.repeat(400) }))).toBeNull();
  });

  it('returns null when base64 decoding throws', () => {
    Object.defineProperty(globalThis, 'atob', {
      value: () => {
        throw new Error('decode failed');
      },
      configurable: true,
      writable: true,
    });

    expect(getJwtExpiryMs(createToken({ exp: 15 }))).toBeNull();
  });

  it('falls back to Buffer decoding when atob is unavailable', () => {
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(getJwtExpiryMs(createToken({ exp: 15 }))).toBe(15_000);
  });

  it('returns null when Buffer decoding throws', () => {
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Buffer', {
      value: {
        from: () => {
          throw new Error('buffer decode failed');
        },
      },
      configurable: true,
      writable: true,
    });

    expect(getJwtExpiryMs(createToken({ exp: 15 }))).toBeNull();
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

  it('reads the payload from tokens with extra segments', () => {
    expect(getJwtExpiryMs(`${createToken({ exp: 20 })}.extra`)).toBe(20_000);
  });

  it('prefers jwt expiry, then fallback expiry, then default ttl', () => {
    expect(resolveSessionExpiryMs(createToken({ exp: 10 }), 20, 1_000)).toBe(10_000);
    expect(resolveSessionExpiryMs('invalid', 20, 1_000)).toBe(20);
    expect(resolveSessionExpiryMs('invalid', Number.NaN, 1_000)).toBe(2_592_001_000);
    expect(resolveSessionExpiryMs('invalid', Number.POSITIVE_INFINITY, 1_000)).toBe(2_592_001_000);
    expect(resolveSessionExpiryMs('invalid', 0, 1_000)).toBe(2_592_001_000);
    expect(resolveSessionExpiryMs('invalid', -1, 1_000)).toBe(2_592_001_000);
  });
});
