import { describe, expect, it, mock } from 'bun:test';

const storageState = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storageState.set(key, value);
    },
    removeItem: async (key: string) => {
      storageState.delete(key);
    },
  },
}));

mock.module('expo-sqlite', () => ({
  __esModule: true,
  openDatabaseSync: () => ({
    getAllSync: (sql: string) =>
      sql.includes('sqlite_master WHERE type="table"') ? [{ name: 'auth_sessions' }] : [],
    closeSync: () => {},
  }),
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    warn: mock(() => {}),
  },
}));

mock.module('../../observability/metrics', () => ({
  mobileMetrics: {
    incrementCounter: mock(() => {}),
  },
}));

describe('handleEncryptionMigration unavailable deleteDatabaseSync', () => {
  it('refuses plaintext migration when database deletion is unavailable', async () => {
    const { handleEncryptionMigration, ENCRYPTED_DB_MARKER_KEY } = await import(
      '../../storage/encryption-migration'
    );

    await expect(handleEncryptionMigration()).rejects.toThrow('deleteDatabaseSync unavailable');
    expect(storageState.has(ENCRYPTED_DB_MARKER_KEY)).toBe(false);
  });
});
