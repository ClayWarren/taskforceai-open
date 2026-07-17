import type { RNG } from '@taskforceai/client-core/random/rng';

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
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = (Math.random() * 16) | 0;
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }
}

export class FixedRNG implements RNG {
  constructor(
    private nextValue = 0.5,
    private nextUuid = '00000000-0000-0000-0000-000000000000'
  ) {}

  random(): number {
    return this.nextValue;
  }

  uuid(): string {
    return this.nextUuid;
  }

  setNextRandom(value: number): void {
    this.nextValue = value;
  }

  setNextUuid(value: string): void {
    this.nextUuid = value;
  }
}

export const systemRNG = new RealRNG();

const uuidFromBytes = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
};
