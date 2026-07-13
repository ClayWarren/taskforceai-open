import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const REMOTE_DEVICE_CREDENTIAL_KEY = 'taskforceai_remote_device_credential_v1';
const REMOTE_DEVICE_CREDENTIAL_BYTES = 32;

const isValidRemoteDeviceCredential = (value: string | null): value is string =>
  value !== null && value.length >= 43 && value.length <= 128;

export const readOrCreateRemoteDeviceCredential = async (): Promise<string> => {
  const stored = await SecureStore.getItemAsync(REMOTE_DEVICE_CREDENTIAL_KEY);
  if (isValidRemoteDeviceCredential(stored)) return stored;

  const bytes = await Crypto.getRandomBytesAsync(REMOTE_DEVICE_CREDENTIAL_BYTES);
  const credential = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(REMOTE_DEVICE_CREDENTIAL_KEY, credential, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return credential;
};
