import { beforeEach, describe, expect, it, mock } from 'bun:test';

let storedCredential: string | null = null;
const getItemAsync = mock(async () => storedCredential);
const setItemAsync = mock(async (_key: string, value: string) => {
  storedCredential = value;
});
const getRandomBytesAsync = mock(async () =>
  Uint8Array.from(Array.from({ length: 32 }, (_, index) => index))
);

mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync,
  setItemAsync,
}));

mock.module('expo-crypto', () => ({ getRandomBytesAsync }));

const { readOrCreateRemoteDeviceCredential } = await import(
  '../../desktop-pairing/remote-credential'
);

describe('Remote device credential', () => {
  beforeEach(() => {
    storedCredential = null;
    getItemAsync.mockClear();
    setItemAsync.mockClear();
    getRandomBytesAsync.mockClear();
  });

  it('generates a 256-bit secret once and stores it in the device-only keychain', async () => {
    const credential = await readOrCreateRemoteDeviceCredential();

    expect(credential).toHaveLength(64);
    expect(getRandomBytesAsync).toHaveBeenCalledWith(32);
    expect(setItemAsync).toHaveBeenCalledWith(
      'taskforceai_remote_device_credential_v1',
      credential,
      { keychainAccessible: 'when-unlocked-this-device-only' }
    );

    await expect(readOrCreateRemoteDeviceCredential()).resolves.toBe(credential);
    expect(getRandomBytesAsync).toHaveBeenCalledTimes(1);
  });
});
