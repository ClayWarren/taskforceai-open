/**
 * Encryption Migration - safely upgrades legacy plaintext databases to SQLCipher.
 *
 * The migration first creates and verifies an encrypted recovery database. Only
 * then does it replace the original database. A durable pending marker lets the
 * next launch resume from the encrypted recovery copy after an interruption.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';

import { mobileLogger } from '../../logger';
import { mobileMetrics } from '../../observability/metrics';
import { applyEncryptionKey } from './encryption';

const DB_NAME = 'taskforceai.db';
export const ENCRYPTION_MIGRATION_BACKUP_DB_NAME = 'taskforceai-encryption-migration.db';

export const ENCRYPTED_DB_MARKER_KEY = '@taskforceai:db_encrypted';
export const LEGACY_PLAINTEXT_MODE_KEY = '@taskforceai:legacy_plaintext_mode';
export const ENCRYPTION_MIGRATION_PENDING_KEY = '@taskforceai:db_encryption_migration_pending';

export type EncryptionMigrationMode = 'encrypted' | 'legacy-plaintext';

type TableSnapshot = Array<{ name: string; rowCount: number }>;

type SQLiteMigrationModule = typeof SQLite & {
  deleteDatabaseSync?: (name: string) => void;
};

const isUnsafePlaintextMigrationError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes('Cannot safely migrate legacy plaintext database');

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;

const closeQuietly = (db: SQLite.SQLiteDatabase | null): void => {
  if (!db) return;
  try {
    db.closeSync();
  } catch {
    // The migration retains another verified copy before closing becomes destructive.
  }
};

const readUserTableSnapshot = (db: SQLite.SQLiteDatabase): TableSnapshot => {
  const tables = db
    .getAllSync<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table" AND name != "__drizzle_migrations"'
    )
    .map((table) => table.name)
    .filter((name) => !name.startsWith('sqlite_'))
    .toSorted();

  return tables.map((name) => {
    const count = db.getAllSync<{ rowCount: number }>(
      `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(name)}`
    )[0]?.rowCount;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Cannot safely migrate legacy plaintext database: invalid row count for ${name}.`);
    }
    return { name, rowCount: count };
  });
};

const assertMatchingSnapshot = (expected: TableSnapshot, actual: TableSnapshot): void => {
  if (
    expected.length !== actual.length ||
    expected.some(
      (table, index) =>
        table.name !== actual[index]?.name || table.rowCount !== actual[index]?.rowCount
    )
  ) {
    throw new Error(
      'Cannot safely migrate legacy plaintext database: encrypted copy verification failed.'
    );
  }
};

const requireMigrationModule = (): SQLiteMigrationModule => {
  const migrationModule = SQLite as SQLiteMigrationModule;
  if (typeof migrationModule.deleteDatabaseSync !== 'function') {
    throw new Error(
      'Cannot safely migrate legacy plaintext database: deleteDatabaseSync unavailable.'
    );
  }
  return migrationModule;
};

const databasePath = (databaseName: string): string => {
  const directory = SQLite.defaultDatabaseDirectory;
  if (!directory) {
    throw new Error(
      'Cannot safely migrate legacy plaintext database: default database directory unavailable.'
    );
  }
  return `${directory.replace(/\/+$/, '')}/${databaseName.replace(/^\/+/, '')}`;
};

const exportEncryptedCopy = (
  sourceDb: SQLite.SQLiteDatabase,
  destinationDatabaseName: string,
  encryptionKey: string,
  schemaName: 'encrypted_migration' | 'encrypted_restore'
): void => {
  if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error('Cannot safely migrate legacy plaintext database: invalid encryption key.');
  }
  const escapedPath = databasePath(destinationDatabaseName).replaceAll("'", "''");
  sourceDb.execSync(
    `ATTACH DATABASE '${escapedPath}' AS ${schemaName} KEY "x'${encryptionKey}'";`
  );
  try {
    sourceDb.getAllSync(`SELECT sqlcipher_export('${schemaName}')`);
  } finally {
    sourceDb.execSync(`DETACH DATABASE ${schemaName};`);
  }
};

const openEncryptedDatabase = (
  databaseName: string,
  encryptionKey: string
): SQLite.SQLiteDatabase => {
  const db = SQLite.openDatabaseSync(databaseName, { useNewConnection: true });
  applyEncryptionKey(db, encryptionKey);
  db.getAllSync('SELECT 1');
  return db;
};

const restoreEncryptedDatabaseFromBackup = async (
  encryptionKey: string,
  expectedSnapshot?: TableSnapshot
): Promise<EncryptionMigrationMode> => {
  const migrationModule = requireMigrationModule();
  let backupDb: SQLite.SQLiteDatabase | null = null;
  let destinationDb: SQLite.SQLiteDatabase | null = null;

  try {
    backupDb = openEncryptedDatabase(ENCRYPTION_MIGRATION_BACKUP_DB_NAME, encryptionKey);
    const backupSnapshot = readUserTableSnapshot(backupDb);
    if (!expectedSnapshot && backupSnapshot.length === 0) {
      throw new Error(
        'Cannot safely migrate legacy plaintext database: encrypted recovery copy is empty.'
      );
    }
    if (expectedSnapshot) {
      assertMatchingSnapshot(expectedSnapshot, backupSnapshot);
    }

    migrationModule.deleteDatabaseSync!(DB_NAME);
    exportEncryptedCopy(backupDb, DB_NAME, encryptionKey, 'encrypted_restore');
    destinationDb = openEncryptedDatabase(DB_NAME, encryptionKey);
    assertMatchingSnapshot(backupSnapshot, readUserTableSnapshot(destinationDb));
  } catch (error) {
    throw new Error(
      'Cannot safely migrate legacy plaintext database: encrypted recovery copy retained for retry.',
      { cause: error }
    );
  } finally {
    closeQuietly(destinationDb);
    closeQuietly(backupDb);
  }

  await AsyncStorage.setItem(ENCRYPTED_DB_MARKER_KEY, 'true');
  await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
  await AsyncStorage.removeItem(ENCRYPTION_MIGRATION_PENDING_KEY);

  try {
    migrationModule.deleteDatabaseSync!(ENCRYPTION_MIGRATION_BACKUP_DB_NAME);
  } catch (error) {
    mobileLogger.warn('[EncryptionMigration] Failed to remove encrypted migration backup', {
      error,
    });
  }

  mobileMetrics.incrementCounter('db.encryption.mode', { mode: 'encrypted' });
  return 'encrypted';
};

const migratePlaintextDatabase = async (
  plaintextDb: SQLite.SQLiteDatabase,
  plaintextSnapshot: TableSnapshot,
  encryptionKey: string
): Promise<EncryptionMigrationMode> => {
  const migrationModule = requireMigrationModule();
  let backupDb: SQLite.SQLiteDatabase | null = null;

  try {
    try {
      migrationModule.deleteDatabaseSync!(ENCRYPTION_MIGRATION_BACKUP_DB_NAME);
    } catch {
      // A missing stale backup is expected on the first migration attempt.
    }

    exportEncryptedCopy(
      plaintextDb,
      ENCRYPTION_MIGRATION_BACKUP_DB_NAME,
      encryptionKey,
      'encrypted_migration'
    );
    backupDb = openEncryptedDatabase(ENCRYPTION_MIGRATION_BACKUP_DB_NAME, encryptionKey);
    assertMatchingSnapshot(plaintextSnapshot, readUserTableSnapshot(backupDb));
    await AsyncStorage.setItem(ENCRYPTION_MIGRATION_PENDING_KEY, 'true');
  } catch (error) {
    closeQuietly(backupDb);
    try {
      migrationModule.deleteDatabaseSync!(ENCRYPTION_MIGRATION_BACKUP_DB_NAME);
    } catch {
      // The original plaintext database remains authoritative and untouched.
    }
    throw new Error(
      'Cannot safely migrate legacy plaintext database: failed to create verified encrypted copy.',
      { cause: error }
    );
  }

  closeQuietly(backupDb);
  closeQuietly(plaintextDb);
  return restoreEncryptedDatabaseFromBackup(encryptionKey, plaintextSnapshot);
};

/** Handle migration from an unencrypted database to an encrypted one. */
export async function handleEncryptionMigration(
  encryptionKey: string
): Promise<EncryptionMigrationMode> {
  const migrationPending = await AsyncStorage.getItem(ENCRYPTION_MIGRATION_PENDING_KEY);
  if (migrationPending === 'true') {
    mobileLogger.warn('[EncryptionMigration] Resuming interrupted encrypted database migration');
    return restoreEncryptedDatabaseFromBackup(encryptionKey);
  }

  const isEncrypted = await AsyncStorage.getItem(ENCRYPTED_DB_MARKER_KEY);
  if (isEncrypted === 'true') {
    await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
    mobileMetrics.incrementCounter('db.encryption.mode', { mode: 'encrypted' });
    return 'encrypted';
  }

  let testDb: SQLite.SQLiteDatabase | null = null;
  try {
    testDb = SQLite.openDatabaseSync(DB_NAME, { useNewConnection: true });
    testDb.getAllSync<{ name: string }>('SELECT name FROM sqlite_master LIMIT 1');
    const plaintextSnapshot = readUserTableSnapshot(testDb);

    if (plaintextSnapshot.length > 0) {
      mobileLogger.warn(
        '[EncryptionMigration] Detected legacy plaintext database. Creating verified encrypted copy.',
        { tables: plaintextSnapshot.map((table) => table.name) }
      );
      return await migratePlaintextDatabase(testDb, plaintextSnapshot, encryptionKey);
    }

    closeQuietly(testDb);
    testDb = null;
    await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
  } catch (error) {
    closeQuietly(testDb);
    if (isUnsafePlaintextMigrationError(error)) {
      throw error;
    }
    // The file may already be encrypted while its marker is missing. The normal
    // keyed open below is the authoritative validation for that case.
  }

  await AsyncStorage.setItem(ENCRYPTED_DB_MARKER_KEY, 'true');
  await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
  return 'encrypted';
}
