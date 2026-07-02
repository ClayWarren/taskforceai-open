/**
 * Random Number Generator abstraction.
 *
 * Use this instead of `Math.random()` or `crypto` explicitly
 * to allow for seeded/deterministic testing.
 */
export interface RNG {
  /**
   * Returns a random number between 0 (inclusive) and 1 (exclusive).
   * Equivalent to Math.random()
   */
  random(): number;

  /**
   * Generates a UUID string.
   */
  uuid(): string;
}

/**
 * System RNG using native crypto/Math
 */
export class RealRNG implements RNG {
  random(): number {
    return Math.random();
  }

  uuid(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      return uuidFromBytes(bytes);
    }
    // Last resort for environments without Web Crypto.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/**
 * Deterministic RNG for testing.
 * Note: check if you need a specific seedable PRNG (like mulberry32) for complex cases.
 * This is a simple mock for now.
 */
export class MockRNG implements RNG {
  private nextValue: number;
  private nextUuid: string;

  constructor(nextValue = 0.5, nextUuid = '00000000-0000-0000-0000-000000000000') {
    this.nextValue = nextValue;
    this.nextUuid = nextUuid;
  }

  random(): number {
    return this.nextValue;
  }

  uuid(): string {
    return this.nextUuid;
  }

  setNextRandom(val: number) {
    this.nextValue = val;
  }

  setNextUuid(val: string) {
    this.nextUuid = val;
  }
}

/**
 * Global instance of the real RNG.
 * Prefer dependency injection, but use this for default values.
 */
export const systemRNG = new RealRNG();

const uuidFromBytes = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
};
