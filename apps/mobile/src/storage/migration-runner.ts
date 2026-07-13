/**
 * Migration Runner - Drizzle ORM migration orchestration
 *
 * Handles migration tag state management, __drizzle_migrations table seeding,
 * the Drizzle migrate() call, "already exists" error recovery, and the
 * fallback table creation safety net.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import type * as SQLite from 'expo-sqlite';
import { parseJsonSchema } from '@taskforceai/client-core/json/parse';
import { z } from 'zod';

import migrationConfig from '../../drizzle/migrations';
import { mobileLogger } from '../logger';
import { backfillLegacyPromptQueue } from './migration-backfill';
import { createTablesFallback } from './migration-fallback';
import type { MobileSchema } from '@taskforceai/db-sync/drizzle/schema';

const MIGRATION_STATE_KEY = '@taskforceai:sqlite_migration_tag_v4';
const LATEST_MIGRATION_TAG =
    migrationConfig?.journal?.entries?.[migrationConfig.journal.entries.length - 1]?.tag ?? 'none';
const REQUIRED_TABLES = [
    'auth_sessions',
    'conversations',
    'messages',
    'metadata',
    'pending_changes',
    'pending_prompts',
    'prompt_queue',
    'user_profiles',
];

type MigrationConfig = Parameters<typeof migrate>[1];
const MigrationConfigSchema = z.custom<MigrationConfig>((data) => {
    return typeof data === 'object' && data !== null;
});

const DROP_INDEX_STATEMENT = /\bDROP\s+INDEX\s+(?!IF\s+EXISTS\b)/gi;
const hasNoMigrationTag = (tag: string | null): boolean => tag === null || tag === 'none';

const normalizeSQLiteMigrationConfig = (config: MigrationConfig): MigrationConfig => {
    const migrationRecord = (config as { migrations?: Record<string, string> }).migrations;
    if (!migrationRecord) {
        return config;
    }

    for (const [key, sql] of Object.entries(migrationRecord)) {
        migrationRecord[key] = sql.replace(DROP_INDEX_STATEMENT, 'DROP INDEX IF EXISTS ');
    }
    return config;
};

/**
 * Run Drizzle ORM migrations, handling tag state, seeding, and error recovery.
 */
export async function runDrizzleMigrations(
    orm: ExpoSQLiteDatabase<MobileSchema>,
    rawDb: SQLite.SQLiteDatabase
): Promise<void> {
    const appliedTag = await AsyncStorage.getItem(MIGRATION_STATE_KEY);
    let effectiveAppliedTag = appliedTag;

    const tablesResult = rawDb.getAllSync<{ name: string }>('SELECT name FROM sqlite_master WHERE type="table"');
    const tableNamesSet = new Set(tablesResult.map(t => t.name));
    const hasUserTables = [...tableNamesSet].some((tableName) => !tableName.startsWith('sqlite_'));

    if (!hasUserTables && hasNoMigrationTag(effectiveAppliedTag)) {
        mobileLogger.info('[MigrationRunner] Bootstrapping fresh database at current schema', {
            tag: LATEST_MIGRATION_TAG,
        });
        createTablesFallback(rawDb);
        await AsyncStorage.setItem(MIGRATION_STATE_KEY, LATEST_MIGRATION_TAG);
        effectiveAppliedTag = LATEST_MIGRATION_TAG;
    }

    // Bootstrap: if app tables exist but no migration tag is recorded,
    // treat the database as current and let the fallback/patch steps repair
    // any legacy columns without replaying the squashed baseline.
    const hasAppTables = REQUIRED_TABLES.some((tableName) => tableNamesSet.has(tableName));
    if (hasAppTables && hasNoMigrationTag(effectiveAppliedTag)) {
        mobileLogger.info('[MigrationRunner] Bootstrapping migration tag', { tag: LATEST_MIGRATION_TAG });
        await AsyncStorage.setItem(MIGRATION_STATE_KEY, LATEST_MIGRATION_TAG);
        effectiveAppliedTag = LATEST_MIGRATION_TAG;
    }

    if (effectiveAppliedTag !== LATEST_MIGRATION_TAG) {
        mobileLogger.info('[MigrationRunner] Starting migrations', { from: effectiveAppliedTag, to: LATEST_MIGRATION_TAG });
        try {
            // Ensure __drizzle_migrations exists and is seeded if we are bootstrapping
            if (effectiveAppliedTag) {
                rawDb.execSync('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)');
                const drizzleRows = rawDb.getAllSync<{ id: number }>('SELECT id FROM __drizzle_migrations LIMIT 1');
                if (drizzleRows.length === 0) {
                    for (const entry of migrationConfig.journal.entries) {
                        if (entry.tag <= effectiveAppliedTag) {
                            rawDb.runSync('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', ['', entry.when]);
                        }
                    }
                }
            }

            const cloneResult = parseJsonSchema(JSON.stringify(migrationConfig), MigrationConfigSchema);
            if (!cloneResult.ok) throw new Error('Invalid migration config');

            // The Expo SQLite migrator starts its own transaction. Wrapping it in a raw
            // transaction on the same connection fails natively with "cannot start a
            // transaction within a transaction".
            await migrate(orm, normalizeSQLiteMigrationConfig(cloneResult.value));
            await AsyncStorage.setItem(MIGRATION_STATE_KEY, LATEST_MIGRATION_TAG);
            mobileLogger.info('[MigrationRunner] Migrations completed successfully');
        } catch (migError: any) {
            const errorMessage = migError?.message || String(migError);
            if (errorMessage.toLowerCase().includes('already exists') || errorMessage.toLowerCase().includes('duplicate table')) {
                mobileLogger.info('[MigrationRunner] Migration reported "already exists", marking as done.');
                await AsyncStorage.setItem(MIGRATION_STATE_KEY, LATEST_MIGRATION_TAG);
            } else {
                throw migError;
            }
        }
    }

    // Final check for required tables
    const finalTables = rawDb.getAllSync<{ name: string }>('SELECT name FROM sqlite_master WHERE type="table"');
    const finalTableNames = new Set(finalTables.map(t => t.name));
    const missingTables = REQUIRED_TABLES.filter(t => !finalTableNames.has(t));
  if (missingTables.length > 0) {
    mobileLogger.warn('[MigrationRunner] Required tables missing, applying fallback');
    createTablesFallback(rawDb);
  }

  const promptQueueColumns = rawDb.getAllSync<{ name: string }>('PRAGMA table_info("prompt_queue")');
  const hasAttachmentIds = promptQueueColumns.some((col) => col.name === 'attachment_ids');
  if (!hasAttachmentIds) {
    mobileLogger.info('[MigrationRunner] Adding missing prompt_queue.attachment_ids column');
    rawDb.execSync('ALTER TABLE prompt_queue ADD COLUMN attachment_ids TEXT;');
  }

  const userProfilesColumns = rawDb.getAllSync<{ name: string }>('PRAGMA table_info("user_profiles")');
  const hasUserProfileId = userProfilesColumns.some((col) => col.name === 'id');
  if (!hasUserProfileId) {
    mobileLogger.info('[MigrationRunner] Adding missing user_profiles.id column');
    rawDb.execSync('ALTER TABLE user_profiles ADD COLUMN id INTEGER NOT NULL DEFAULT 0;');
    rawDb.execSync('UPDATE user_profiles SET id = rowid WHERE id = 0;');
  }

  const conversationColumns = rawDb.getAllSync<{ name: string }>('PRAGMA table_info("conversations")');
  const hasIsArchived = conversationColumns.some((col) => col.name === 'is_archived');
  if (!hasIsArchived) {
    mobileLogger.info('[MigrationRunner] Adding missing conversations.is_archived column');
    rawDb.execSync('ALTER TABLE conversations ADD COLUMN is_archived INTEGER DEFAULT 0 NOT NULL;');
  }

  backfillLegacyPromptQueue(rawDb);
}

/** Exposed for use by DatabaseManager.resetDatabase() */
export const MIGRATION_STATE_KEY_EXPORT = MIGRATION_STATE_KEY;
