/**
 * Encryption Migration - Detects legacy plaintext databases and decides encryption mode
 *
 * If legacy plaintext tables are detected, delete the plaintext database so
 * a fresh encrypted SQLCipher database is created on next open.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';

import { mobileLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';

const DB_NAME = 'taskforceai.db';

export const ENCRYPTED_DB_MARKER_KEY = '@taskforceai:db_encrypted';
export const LEGACY_PLAINTEXT_MODE_KEY = '@taskforceai:legacy_plaintext_mode';

export type EncryptionMigrationMode = 'encrypted' | 'legacy-plaintext';

const isUnsafePlaintextMigrationError = (error: unknown): boolean =>
    error instanceof Error &&
    error.message.includes('Cannot safely migrate legacy plaintext database');

/**
 * Handle migration from an unencrypted database to an encrypted one.
 *
 * If legacy plaintext tables are detected, delete the plaintext database so
 * a fresh encrypted SQLCipher database is created on next open.
 */
export async function handleEncryptionMigration(): Promise<EncryptionMigrationMode> {
    const isEncrypted = await AsyncStorage.getItem(ENCRYPTED_DB_MARKER_KEY);
    if (isEncrypted === 'true') {
        await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
        mobileMetrics.incrementCounter('db.encryption.mode', { mode: 'encrypted' });
        return 'encrypted';
    }

    // Check whether a legacy unencrypted database file exists by trying to
    // open it without a key and running a quick query.
    try {
        const testDb = SQLite.openDatabaseSync(DB_NAME, { useNewConnection: true });
        try {
            // If this succeeds the database is unencrypted (or doesn't exist yet).
            testDb.getAllSync<{ name: string }>('SELECT name FROM sqlite_master LIMIT 1');
            const tables = testDb.getAllSync<{ name: string }>(
                'SELECT name FROM sqlite_master WHERE type="table" AND name != "__drizzle_migrations"'
            );
            testDb.closeSync();

            const userTables = tables.filter((t) => !t.name.startsWith('sqlite_'));

            if (userTables.length > 0) {
                mobileLogger.warn(
                    '[EncryptionMigration] Detected legacy plaintext database. Deleting file before encrypted reinitialization.',
                    { tables: userTables.map((t) => t.name) }
                );

                const sqliteWithDelete = SQLite as typeof SQLite & {
                    deleteDatabaseSync?: (name: string) => void;
                };
                if (typeof sqliteWithDelete.deleteDatabaseSync !== 'function') {
                    throw new Error('Cannot safely migrate legacy plaintext database: deleteDatabaseSync unavailable.');
                }

                try {
                    sqliteWithDelete.deleteDatabaseSync(DB_NAME);
                } catch (error) {
                    throw new Error(
                        'Cannot safely migrate legacy plaintext database: failed to delete plaintext database.',
                        { cause: error }
                    );
                }
                await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
                mobileMetrics.incrementCounter('db.encryption.mode', { mode: 'encrypted' });
                await AsyncStorage.setItem(ENCRYPTED_DB_MARKER_KEY, 'true');
                return 'encrypted';
            }

            await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
        } catch (error) {
            if (isUnsafePlaintextMigrationError(error)) {
                throw error;
            }
            // Query failed - DB might already be encrypted or corrupt. Close and
            // let the normal open path handle it.
            try { testDb.closeSync(); } catch { /* ignore */ }
        }
    } catch (error) {
        if (isUnsafePlaintextMigrationError(error)) {
            throw error;
        }
        // Could not open at all - no existing file, nothing to migrate.
    }

    await AsyncStorage.setItem(ENCRYPTED_DB_MARKER_KEY, 'true');
    await AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY);
    return 'encrypted';
}
