import { describe, expect, it } from 'bun:test';

import { MockRNG, RealRNG, systemRNG } from './rng';

describe('random/rng', () => {
  describe('RealRNG', () => {
    it('random returns a number between 0 and 1', () => {
      const rng = new RealRNG();
      const value = rng.random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });

    it('uuid returns a valid UUID string', () => {
      const rng = new RealRNG();
      const uuid = rng.uuid();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('generates unique UUIDs', () => {
      const rng = new RealRNG();
      const uuids = new Set([rng.uuid(), rng.uuid(), rng.uuid()]);
      expect(uuids.size).toBe(3);
    });

    it('uses getRandomValues when randomUUID is unavailable', () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      let requestedLength = 0;

      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues(bytes: Uint8Array) {
            requestedLength = bytes.length;
            for (let i = 0; i < bytes.length; i += 1) {
              bytes[i] = i;
            }
            return bytes;
          },
        },
      });

      try {
        const uuid = new RealRNG().uuid();
        expect(requestedLength).toBe(16);
        expect(uuid).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, 'crypto', originalDescriptor);
        } else {
          delete (globalThis as { crypto?: Crypto }).crypto;
        }
      }
    });
  });

  describe('MockRNG', () => {
    it('returns fixed random value', () => {
      const rng = new MockRNG(0.42);
      expect(rng.random()).toBe(0.42);
      expect(rng.random()).toBe(0.42); // Still returns the same
    });

    it('returns fixed UUID', () => {
      const rng = new MockRNG(0.5, 'test-uuid-1234');
      expect(rng.uuid()).toBe('test-uuid-1234');
    });

    it('uses default values', () => {
      const rng = new MockRNG();
      expect(rng.random()).toBe(0.5);
      expect(rng.uuid()).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('setNextRandom updates the random value', () => {
      const rng = new MockRNG();
      rng.setNextRandom(0.9);
      expect(rng.random()).toBe(0.9);
    });

    it('setNextUuid updates the UUID', () => {
      const rng = new MockRNG();
      rng.setNextUuid('new-uuid');
      expect(rng.uuid()).toBe('new-uuid');
    });
  });

  describe('systemRNG', () => {
    it('is a RealRNG instance', () => {
      expect(systemRNG).toBeInstanceOf(RealRNG);
    });

    it('random works', () => {
      const value = systemRNG.random();
      expect(typeof value).toBe('number');
    });

    it('uuid works', () => {
      const uuid = systemRNG.uuid();
      expect(typeof uuid).toBe('string');
    });
  });
});
