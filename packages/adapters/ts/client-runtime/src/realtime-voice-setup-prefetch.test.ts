import { describe, expect, it } from 'bun:test';

import {
  normalizeRealtimeSetupExpiryMs,
  RealtimeVoiceSetupPrefetchCache,
} from './realtime-voice-setup-prefetch';

describe('RealtimeVoiceSetupPrefetchCache', () => {
  it('normalizes second and millisecond expiry timestamps', () => {
    expect(normalizeRealtimeSetupExpiryMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(normalizeRealtimeSetupExpiryMs(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(normalizeRealtimeSetupExpiryMs('soon')).toBeNull();
  });

  it('stores and consumes a setup payload once for the matching key', () => {
    let now = 1_000;
    const cache = new RealtimeVoiceSetupPrefetchCache<{ expiresAt?: number; token: string }>({
      now: () => now,
      maxAgeMs: 1_000,
    });

    expect(cache.store('key-1', { token: 'prefetched' })).toBe(true);
    expect(cache.hasUsable('key-1')).toBe(true);
    expect(cache.consume('key-2')).toBeNull();
    now = 1_500;
    expect(cache.consume('key-1')).toEqual({ token: 'prefetched' });
    expect(cache.consume('key-1')).toBeNull();
  });

  it('caps usability by token expiry and skew', () => {
    const cache = new RealtimeVoiceSetupPrefetchCache<{ expiresAt?: number; token: string }>({
      now: () => 10_000,
      maxAgeMs: 45_000,
      expirySkewMs: 10_000,
    });

    expect(cache.getUsableUntil({ token: 'short', expiresAt: 30 })).toBe(20_000);
    expect(cache.store('key', { token: 'expired', expiresAt: 19 })).toBe(false);
  });

  it('tracks freshness with a refresh window', () => {
    let now = 10_000;
    const cache = new RealtimeVoiceSetupPrefetchCache<{ expiresAt?: number; token: string }>({
      now: () => now,
      maxAgeMs: 45_000,
      refreshWindowMs: 15_000,
    });

    cache.store('key', { token: 'prefetched' });
    expect(cache.hasFresh('key')).toBe(true);

    now = 40_001;
    expect(cache.hasUsable('key')).toBe(true);
    expect(cache.hasFresh('key')).toBe(false);
  });
});
