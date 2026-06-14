import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const ENCRYPTED_DB_MARKER_KEY = '@taskforceai:db_encrypted';
const LEGACY_PLAINTEXT_MODE_KEY = '@taskforceai:legacy_plaintext_mode';
const MIGRATION_STATE_KEY = '@taskforceai:sqlite_migration_tag_v4';
const SCHEMA_PATCH_VERSION_KEY = '@taskforceai:last_schema_patch_v1';

const storageState = new Map<string, string>();
const clearAuthTokenMock = mock(async () => {});

const sqliteState = {
  tables: [] as string[],
  throwProbeError: false,
  openDatabaseSync: mock(() => ({
    getAllSync: (sql: string) => {
      if (sqliteState.throwProbeError) {
        throw new Error('probe failure');
      }
      if (sql.includes('sqlite_master WHERE type="table"')) {
        return sqliteState.tables.map((name) => ({ name }));
      }
      return [];
    },
    closeSync: () => { },
  })),
  deleteDatabaseSync: mock(() => { }),
};

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
    multiRemove: async (keys: string[]) => {
      for (const key of keys) storageState.delete(key);
    },
  },
}));

mock.module('expo-sqlite', () => ({
  __esModule: true,
  openDatabaseSync: (...args: unknown[]) => sqliteState.openDatabaseSync(...args),
  deleteDatabaseSync: (...args: unknown[]) => sqliteState.deleteDatabaseSync(...args),
  addDatabaseChangeListener: () => ({ remove: () => { } }),
  defaultDatabaseDirectory: '/tmp',
}));

mock.module('drizzle-orm/expo-sqlite', () => ({
  __esModule: true,
  drizzle: () => ({}),
}));

mock.module('drizzle-orm/expo-sqlite/migrator', () => ({
  __esModule: true,
  migrate: async () => {},
}));

mock.module('../../storage/migration-runner', () => ({
  __esModule: true,
  runDrizzleMigrations: async () => {},
  MIGRATION_STATE_KEY_EXPORT: '@taskforceai:sqlite_migration_tag_v4',
}));

mock.module('../../storage/schema', () => ({
  __esModule: true,
  mobileSchema: {},
}));

mock.module('../../storage/encryption', () => ({
  __esModule: true,
  getOrCreateEncryptionKey: async () => 'test-key',
  applyEncryptionKey: () => {},
}));

mock.module('../../storage/schema-patches', () => ({
  __esModule: true,
  applyLegacySchemaPatches: () => {},
}));

mock.module('../../auth/token-store', () => ({
  clearAuthToken: clearAuthTokenMock,
}));

describe('DatabaseManager encryption migration', () => {
  beforeEach(() => {
    storageState.clear();
    sqliteState.tables = [];
    sqliteState.throwProbeError = false;
    sqliteState.openDatabaseSync.mockClear();
    sqliteState.deleteDatabaseSync.mockClear();
    clearAuthTokenMock.mockClear();
  });

  afterAll(() => {
    mock.restore();
  });

  const runMigrationProbe = async (): Promise<string> => {
    const { handleEncryptionMigration } = await import('../../storage/encryption-migration');
    return handleEncryptionMigration();
  };

  it('returns encrypted mode when marker is already set', async () => {
    storageState.set(ENCRYPTED_DB_MARKER_KEY, 'true');

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(sqliteState.openDatabaseSync).not.toHaveBeenCalled();
  });

  it('deletes legacy plaintext databases before encrypted reinitialization', async () => {
    sqliteState.tables = ['auth_sessions', 'user_profiles'];

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
    expect(storageState.has(LEGACY_PLAINTEXT_MODE_KEY)).toBe(false);
    expect(sqliteState.deleteDatabaseSync).toHaveBeenCalledWith('taskforceai.db');
  });

  it('marks encrypted mode when no legacy tables are detected', async () => {
    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
    expect(storageState.has(LEGACY_PLAINTEXT_MODE_KEY)).toBe(false);
  });

  it('falls back to encrypted mode when plaintext probe fails', async () => {
    sqliteState.throwProbeError = true;

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
  });

  it('resetDatabase deletes the database file and clears migration/encryption markers', async () => {
    storageState.set(MIGRATION_STATE_KEY, '0001_skinny_dagger');
    storageState.set(ENCRYPTED_DB_MARKER_KEY, 'true');
    storageState.set(LEGACY_PLAINTEXT_MODE_KEY, 'true');
    storageState.set(SCHEMA_PATCH_VERSION_KEY, '0007_crazy_tombstone');

    const { dbManager } = await import('../../storage/database-manager');
    await dbManager.resetDatabase();

    expect(sqliteState.deleteDatabaseSync).toHaveBeenCalledWith('taskforceai.db');
    expect(storageState.has(MIGRATION_STATE_KEY)).toBe(false);
    expect(storageState.has(ENCRYPTED_DB_MARKER_KEY)).toBe(false);
    expect(storageState.has(LEGACY_PLAINTEXT_MODE_KEY)).toBe(false);
    expect(storageState.has(SCHEMA_PATCH_VERSION_KEY)).toBe(false);
    expect(clearAuthTokenMock).toHaveBeenCalledTimes(1);
  });
});
