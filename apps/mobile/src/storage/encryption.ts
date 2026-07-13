/**
 * Database Encryption Key Manager
 *
 * Generates and persists a random encryption key for SQLCipher using
 * expo-secure-store (backed by Keychain on iOS, Keystore on Android).
 *
 * The key is a 64-character hex string (256-bit), generated once on first
 * launch and reused on subsequent launches.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { mobileLogger } from '../logger';

const ENCRYPTION_KEY_ALIAS = 'taskforceai.sqlite_encryption_key';
const ENCRYPTION_KEY_PATTERN = /^[0-9a-f]{64}$/i;

const assertValidEncryptionKey = (hexKey: string): void => {
  if (!ENCRYPTION_KEY_PATTERN.test(hexKey)) {
    throw new Error('SQLite encryption key must be exactly 32 bytes encoded as hexadecimal');
  }
};

/**
 * Retrieve the SQLite encryption key, generating one on first launch.
 *
 * Returns a 64-char hex string suitable for `PRAGMA key = "x'...'";`
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(ENCRYPTION_KEY_ALIAS);
    if (existing) {
      assertValidEncryptionKey(existing);
      mobileLogger.debug('[Encryption] Retrieved existing database encryption key');
      return existing;
    }

    // Generate 32 random bytes (256 bits) and encode as hex
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const hexKey = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await SecureStore.setItemAsync(ENCRYPTION_KEY_ALIAS, hexKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    mobileLogger.info('[Encryption] Generated and stored new database encryption key');
    return hexKey;
  } catch (error) {
    mobileLogger.error('[Encryption] Failed to get or create encryption key', { error });
    throw error;
  }
}

/**
 * Apply the encryption key to an opened SQLCipher database.
 *
 * Must be called immediately after opening the database and before any
 * other operations. Uses the `x'...'` hex-key syntax so SQLCipher treats
 * the value as raw key material rather than a passphrase.
 */
export function applyEncryptionKey(
  db: { execSync: (sql: string) => void },
  hexKey: string
): void {
  assertValidEncryptionKey(hexKey);
  db.execSync(`PRAGMA key = "x'${hexKey}'"`);
}
