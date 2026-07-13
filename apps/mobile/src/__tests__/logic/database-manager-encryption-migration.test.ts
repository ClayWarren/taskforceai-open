import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const ENCRYPTED_DB_MARKER_KEY = '@taskforceai:db_encrypted';
const LEGACY_PLAINTEXT_MODE_KEY = '@taskforceai:legacy_plaintext_mode';
const MIGRATION_STATE_KEY = '@taskforceai:sqlite_migration_tag_v4';
const SCHEMA_PATCH_VERSION_KEY = '@taskforceai:last_schema_patch_v1';

const storageState = new Map<string, string>();
const clearAuthTokenMock = mock(async () => {});

const sqliteState = {
  tables: [] as string[],
  openedDatabases: [] as Array<{
    getAllSync: (sql: string) => Array<{ name: string }>;
    closeSync: () => void;
  }>,
  throwProbeError: false,
  throwOpenError: false,
  throwCloseError: false,
  deleteDatabaseAvailable: true,
  openDatabaseSync: mock(() => {
    const db = {
      getAllSync: (sql: string) => {
      if (sqliteState.throwProbeError) {
        throw new Error('probe failure');
      }
      if (sql.includes('sqlite_master WHERE type="table"')) {
        return sqliteState.tables.map((name) => ({ name }));
      }
      return [];
    },
      closeSync: () => {
      if (sqliteState.throwCloseError) {
        throw new Error('close failure');
      }
    },
    };
    sqliteState.openedDatabases.push(db);
    return db;
  }),
  deleteDatabaseSync: mock(() => { }),
};

const openDatabaseSync = (...args: unknown[]) => {
  if (sqliteState.throwOpenError) {
    throw new Error('open failure');
  }
  return sqliteState.openDatabaseSync(...args);
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

mock.module('expo-sqlite', () => {
  const sqliteModule = {
    __esModule: true,
    openDatabaseSync,
    addDatabaseChangeListener: () => ({ remove: () => { } }),
    defaultDatabaseDirectory: '/tmp',
  };
  Object.defineProperty(sqliteModule, 'deleteDatabaseSync', {
    enumerable: true,
    get: () =>
      sqliteState.deleteDatabaseAvailable
        ? (...args: unknown[]) => sqliteState.deleteDatabaseSync(...args)
        : undefined,
  });
  return sqliteModule;
});

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

mock.module('@taskforceai/db-sync/drizzle/schema', () => ({
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

mock.module('../../config/env', () => ({
  mobileEnv: {
    flags: {
      bunTest: true,
    },
  },
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  },
}));

mock.module('../../observability/metrics', () => ({
  mobileMetrics: {
    incrementCounter: mock(() => {}),
    startTimer: mock(() => mock(() => {})),
  },
}));

describe('DatabaseManager encryption migration', () => {
  beforeEach(() => {
    storageState.clear();
    sqliteState.tables = [];
    sqliteState.openedDatabases = [];
    sqliteState.throwProbeError = false;
    sqliteState.throwOpenError = false;
    sqliteState.throwCloseError = false;
    sqliteState.deleteDatabaseAvailable = true;
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

  it('refuses plaintext migration when deleting the legacy database fails', async () => {
    sqliteState.tables = ['auth_sessions'];
    sqliteState.deleteDatabaseSync.mockImplementationOnce(() => {
      throw new Error('delete failed');
    });

    await expect(runMigrationProbe()).rejects.toThrow('failed to delete plaintext database');
    expect(storageState.has(ENCRYPTED_DB_MARKER_KEY)).toBe(false);
  });

  it('marks encrypted mode when no legacy tables are detected', async () => {
    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
    expect(storageState.has(LEGACY_PLAINTEXT_MODE_KEY)).toBe(false);
  });

  it('ignores SQLite internal tables when deciding whether a plaintext database is legacy user data', async () => {
    sqliteState.tables = ['sqlite_sequence'];

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
    expect(sqliteState.deleteDatabaseSync).not.toHaveBeenCalled();
  });

  it('falls back to encrypted mode when plaintext probe fails', async () => {
    sqliteState.throwProbeError = true;

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
  });

  it('marks encrypted mode when the plaintext probe database cannot be opened', async () => {
    sqliteState.throwOpenError = true;

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
    expect(sqliteState.deleteDatabaseSync).not.toHaveBeenCalled();
  });

  it('ignores close failures after plaintext probe query errors', async () => {
    sqliteState.throwProbeError = true;
    sqliteState.throwCloseError = true;

    const mode = await runMigrationProbe();

    expect(mode).toBe('encrypted');
    expect(storageState.get(ENCRYPTED_DB_MARKER_KEY)).toBe('true');
  });

  it('initializes and caches the ORM in Bun test mode', async () => {
    const { dbManager } = await import('../../storage/database-manager');

    const [firstOrm, secondOrm] = await Promise.all([dbManager.ensureOrm(), dbManager.ensureOrm()]);
    const rawDb = await dbManager.ensureRawDb();

    expect(firstOrm).toBe(secondOrm);
    expect(rawDb).toBe(sqliteState.openedDatabases[0]);
    expect(sqliteState.openDatabaseSync).toHaveBeenCalledTimes(1);
    expect(sqliteState.openDatabaseSync).toHaveBeenCalledWith('taskforceai.db');

    await dbManager.resetDatabase();
  });

  it('clears failed initialization state so ensureOrm can retry', async () => {
    const { dbManager } = await import('../../storage/database-manager');
    sqliteState.throwOpenError = true;

    await expect(dbManager.ensureOrm()).rejects.toThrow('open failure');

    sqliteState.throwOpenError = false;
    const orm = await dbManager.ensureOrm();

    expect(orm).toBeTruthy();
    expect(sqliteState.openDatabaseSync).toHaveBeenCalledTimes(1);
    expect(sqliteState.openedDatabases).toHaveLength(1);

    await dbManager.resetDatabase();
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
