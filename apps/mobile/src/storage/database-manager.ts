/**
 * Database Manager - Orchestrates SQLite connection, encryption, and migrations
 *
 * EX-M4: The SQLite database is encrypted at rest using SQLCipher.
 * The encryption key is stored in expo-secure-store (Keychain / Keystore)
 * and applied via PRAGMA key immediately after opening the database.
 *
 * This module delegates to:
 *   - encryption-migration.ts: plaintext vs encrypted detection
 *   - schema-patches.ts: legacy table rebuilds
 *   - migration-runner.ts: Drizzle migration orchestration
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type ExpoSQLiteDatabase, drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import { clearAuthToken } from '../auth/token-store';
import { mobileEnv } from '../config/env';
import { mobileLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import { type MobileSchema, mobileSchema } from '@taskforceai/db-sync/drizzle/schema';
import { getOrCreateEncryptionKey, applyEncryptionKey } from './encryption';
import {
  handleEncryptionMigration,
  ENCRYPTED_DB_MARKER_KEY,
  LEGACY_PLAINTEXT_MODE_KEY,
} from './encryption-migration';
import { applyLegacySchemaPatches } from './schema-patches';
import { runDrizzleMigrations, MIGRATION_STATE_KEY_EXPORT } from './migration-runner';

import migrationConfig from '../../drizzle/migrations';

const DB_NAME = 'taskforceai.db';
const SCHEMA_PATCH_VERSION_KEY = '@taskforceai:last_schema_patch_v1';
const LATEST_MIGRATION_TAG =
  migrationConfig?.journal?.entries?.[migrationConfig.journal.entries.length - 1]?.tag ?? 'none';

class DatabaseManager {
  private static instance: DatabaseManager;
  private rawDb: SQLite.SQLiteDatabase | null = null;
  private orm: ExpoSQLiteDatabase<MobileSchema> | null = null;
  private initPromise: Promise<void> | null = null;

  private constructor() { }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async ensureOrm(): Promise<ExpoSQLiteDatabase<MobileSchema>> {
    if (!this.initPromise) {
      const stopTimer = mobileMetrics.startTimer('db.init.duration');
      this.initPromise = this.initialize()
        .then(() => {
          stopTimer();
          mobileMetrics.incrementCounter('db.init.success');
        })
        .catch((error) => {
          stopTimer();
          mobileMetrics.incrementCounter('db.init.failure', { error: String(error) });
          mobileLogger.error('[DatabaseManager] Initialization failed', { error });
          this.initPromise = null;
          throw error;
        });
    }
    try {
      await this.initPromise;
    } catch (error) {
      mobileLogger.error('[DatabaseManager] ensureOrm failed', { error });
      throw error;
    }
    if (!this.orm) {
      const err = new Error('Database not initialized');
      mobileLogger.error('[DatabaseManager] ORM is null after init', { error: err });
      throw err;
    }
    return this.orm;
  }

  async ensureRawDb(): Promise<SQLite.SQLiteDatabase> {
    await this.ensureOrm();
    if (!this.rawDb) throw new Error('Database not initialized');
    return this.rawDb;
  }

  private async initialize(): Promise<void> {
    try {
      // In test mode, skip encryption entirely - tests use an in-memory mock.
      if (mobileEnv.flags.bunTest) {
        this.rawDb = SQLite.openDatabaseSync(DB_NAME);
        this.orm = drizzle(this.rawDb, { schema: mobileSchema });
        return;
      }

      // Step 1: Decide encryption mode
      const encryptionMode = await handleEncryptionMigration();
      let encryptionKey: string | null = null;

      if (encryptionMode !== 'encrypted') {
        throw new Error('Unsupported database encryption mode.');
      }

      encryptionKey = await getOrCreateEncryptionKey();
      this.rawDb = SQLite.openDatabaseSync(DB_NAME);
      applyEncryptionKey(this.rawDb, encryptionKey);
      this.rawDb.execSync('PRAGMA journal_mode = WAL;');
      this.rawDb.execSync('PRAGMA foreign_keys = ON;');
      this.rawDb.execSync('PRAGMA busy_timeout = 5000;');

      // Verify connectivity
      this.rawDb.getAllSync('SELECT 1');

      // Step 2: Apply legacy schema patches only when legacy schemas are detected.
      const lastPatchTag = await AsyncStorage.getItem(SCHEMA_PATCH_VERSION_KEY);
      const tablesResult = this.rawDb.getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      );
      const tableNames = tablesResult.map((table) => table.name);
      const patchResult = applyLegacySchemaPatches(this.rawDb, tableNames);

      if (patchResult.changed) {
        // Close and reopen to clear internal statement/schema caches after table rebuilds.
        mobileLogger.info('[DatabaseManager] Refreshing database connection after patches');
        this.rawDb.closeSync();

        this.rawDb = SQLite.openDatabaseSync(DB_NAME);
        if (encryptionKey) {
          applyEncryptionKey(this.rawDb, encryptionKey);
        }
        this.rawDb.execSync('PRAGMA journal_mode = WAL;');
        this.rawDb.execSync('PRAGMA foreign_keys = ON;');
        this.rawDb.execSync('PRAGMA busy_timeout = 5000;');
      }

      if (lastPatchTag !== LATEST_MIGRATION_TAG || patchResult.changed) {
        await AsyncStorage.setItem(SCHEMA_PATCH_VERSION_KEY, LATEST_MIGRATION_TAG);
      }

      // Step 3: Initialize Drizzle ORM and keep it private until migrations finish.
      const orm = drizzle(this.rawDb, { schema: mobileSchema });

      // Step 4: Run Drizzle migrations
      await runDrizzleMigrations(orm, this.rawDb);
      this.orm = orm;
    } catch (error) {
      mobileLogger.error('[DatabaseManager] Failed to initialize database', { error });
      throw error;
    }
  }

  async resetDatabase(): Promise<void> {
    mobileLogger.warn('[DatabaseManager] Resetting database state');
    if (this.rawDb) {
      try {
        this.rawDb.closeSync();
      } catch (error) {
        mobileLogger.warn('[DatabaseManager] Failed to close database before reset', { error });
      }
    }
    this.orm = null;
    this.rawDb = null;
    this.initPromise = null;

    const sqliteWithDelete = SQLite as typeof SQLite & {
      deleteDatabaseSync?: (name: string) => void;
    };

    if (typeof sqliteWithDelete.deleteDatabaseSync === 'function') {
      sqliteWithDelete.deleteDatabaseSync(DB_NAME);
      mobileLogger.info('[DatabaseManager] Deleted SQLite database file', { name: DB_NAME });
    } else {
      mobileLogger.warn(
        '[DatabaseManager] deleteDatabaseSync unavailable; reset will rely on migration state cleanup only.'
      );
    }

    await Promise.all([
      AsyncStorage.removeItem(MIGRATION_STATE_KEY_EXPORT),
      AsyncStorage.removeItem(ENCRYPTED_DB_MARKER_KEY),
      AsyncStorage.removeItem(LEGACY_PLAINTEXT_MODE_KEY),
      AsyncStorage.removeItem(SCHEMA_PATCH_VERSION_KEY),
      clearAuthToken(),
    ]);

    mobileLogger.info('[DatabaseManager] Database reset complete; app will reinitialize storage on next access');
  }
}

export const dbManager = DatabaseManager.getInstance();
