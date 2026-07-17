import { beforeEach, describe, expect, it, mock } from 'bun:test';

const secureStoreState = {
  value: null as string | null,
  getError: null as Error | null,
  setError: null as Error | null,
  setCalls: [] as Array<{ key: string; value: string; options?: Record<string, unknown> }>,
};

const cryptoState = {
  bytes: Uint8Array.from(Array.from({ length: 32 }, (_, index) => index)),
  getRandomBytesCalls: [] as number[],
};

const resetState = () => {
  secureStoreState.value = null;
  secureStoreState.getError = null;
  secureStoreState.setError = null;
  secureStoreState.setCalls = [];
  cryptoState.bytes = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index));
  cryptoState.getRandomBytesCalls = [];
};

mock.module('expo-secure-store', () => ({
  __esModule: true,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: async () => {
    if (secureStoreState.getError) throw secureStoreState.getError;
    return secureStoreState.value;
  },
  setItemAsync: async (key: string, value: string, options?: Record<string, unknown>) => {
    if (secureStoreState.setError) throw secureStoreState.setError;
    secureStoreState.value = value;
    secureStoreState.setCalls.push({ key, value, options });
  },
}));

mock.module('expo-crypto', () => ({
  __esModule: true,
  getRandomBytesAsync: async (size: number) => {
    cryptoState.getRandomBytesCalls.push(size);
    return cryptoState.bytes;
  },
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    debug: () => {},
    info: () => {},
    error: () => {},
  },
}));

describe('database encryption helpers', () => {
  beforeEach(() => {
    resetState();
  });

  it('returns an existing encryption key without generating a new one', async () => {
    secureStoreState.value = 'ab'.repeat(32);
    const { getOrCreateEncryptionKey } = require('../../storage/database/encryption');

    await expect(getOrCreateEncryptionKey()).resolves.toBe('ab'.repeat(32));
    expect(cryptoState.getRandomBytesCalls).toEqual([]);
    expect(secureStoreState.setCalls).toEqual([]);
  });

  it('generates, stores, and returns a 256-bit hex key on first use', async () => {
    cryptoState.bytes = Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
      0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
      0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
      0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    ]);
    const { getOrCreateEncryptionKey } = require('../../storage/database/encryption');

    const key = await getOrCreateEncryptionKey();

    expect(key).toBe('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    expect(cryptoState.getRandomBytesCalls).toEqual([32]);
    expect(secureStoreState.setCalls).toEqual([
      {
        key: 'taskforceai.sqlite_encryption_key',
        value: key,
        options: { keychainAccessible: 'when-unlocked-this-device-only' },
      },
    ]);
  });

  it('propagates SecureStore read failures', async () => {
    secureStoreState.getError = new Error('keychain unavailable');
    const { getOrCreateEncryptionKey } = require('../../storage/database/encryption');

    await expect(getOrCreateEncryptionKey()).rejects.toThrow('keychain unavailable');
  });

  it('applies SQLCipher hex key pragma', () => {
    const execCalls: string[] = [];
    const { applyEncryptionKey } = require('../../storage/database/encryption');

    applyEncryptionKey(
      {
        execSync: (sql: string) => {
          execCalls.push(sql);
        },
      },
      'ab'.repeat(32)
    );

    expect(execCalls).toEqual([`PRAGMA key = "x'${'ab'.repeat(32)}'"`]);
  });

  it('rejects malformed keys before interpolating SQL', () => {
    const execSync = mock(() => undefined);
    const { applyEncryptionKey } = require('../../storage/database/encryption');

    expect(() => applyEncryptionKey({ execSync }, `bad'; DROP TABLE messages; --`)).toThrow(
      'SQLite encryption key must be exactly 32 bytes encoded as hexadecimal'
    );
    expect(execSync).not.toHaveBeenCalled();
  });
});
