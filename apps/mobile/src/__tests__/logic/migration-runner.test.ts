/**
 * Regression tests for migration-runner.ts.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ── Per-test state ───────────────────────────────────────────────────────────

const storageState = new Map<string, string>();

// Track every SQL string passed to rawDb.execSync.
let execSyncCalls: string[] = [];
let runSyncCalls: Array<{ sql: string; params?: unknown[] }> = [];
let sqliteMasterRows: Array<{ name: string }> = [];
let promptQueueRows: unknown[] = [];
let promptPendingChangeRows: unknown[] = [];
let migrateCalls = 0;

// ── Module mocks ─────────────────────────────────────────────────────────────
// These must come before any import of the module under test.

mock.module('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: string) => { storageState.set(key, value); },
    removeItem: async (key: string) => { storageState.delete(key); },
  },
}));

// Replace Drizzle's migrate() with a no-op so we don't need a real ORM or DB.
mock.module('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: async () => {
    migrateCalls += 1;
  },
}));

// ── Module under test ────────────────────────────────────────────────────────

import migrationConfig from '../../../drizzle/migrations';
import { runDrizzleMigrations } from '../../storage/migration-runner';

const latestMigrationTag =
  migrationConfig?.journal?.entries?.[migrationConfig.journal.entries.length - 1]?.tag ?? 'none';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal rawDb mock whose execSync calls are tracked. */
const createMockRawDb = () => ({
  execSync: (sql: string) => {
    execSyncCalls.push(sql.trim());
  },
  getAllSync: (sql: string) => {
    if (sql.includes('sqlite_master')) return sqliteMasterRows;
    if (sql.includes('__drizzle_migrations')) return [];
    if (sql.includes('FROM prompt_queue')) return promptQueueRows;
    if (sql.includes("FROM pending_changes WHERE type = 'prompt'")) return promptPendingChangeRows;
    return [];
  },
  runSync: (sql: string, params?: unknown[]) => {
    runSyncCalls.push({ sql, params });
  },
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('migration-runner', () => {
  beforeEach(() => {
    storageState.clear();
    execSyncCalls = [];
    runSyncCalls = [];
    sqliteMasterRows = [];
    promptQueueRows = [];
    promptPendingChangeRows = [];
    migrateCalls = 0;
  });

  it('wraps Drizzle migrations in an outer exclusive SQLite transaction', async () => {
    // Simulate a database that is behind the latest tag.
    storageState.set('@taskforceai:sqlite_migration_tag_v4', '0001_skinny_dagger');

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(execSyncCalls).toContain('BEGIN EXCLUSIVE;');
    expect(execSyncCalls).toContain('COMMIT;');
    expect(execSyncCalls).not.toContain('ROLLBACK;');
  });

  it('skips Drizzle migrations when already at the latest tag', async () => {
    // Database is up-to-date — no migrations should run.
    storageState.set('@taskforceai:sqlite_migration_tag_v4', latestMigrationTag);

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(execSyncCalls).not.toContain('BEGIN EXCLUSIVE;');
  });

  it('marks the latest tag and updates AsyncStorage after successful migrations', async () => {
    storageState.set('@taskforceai:sqlite_migration_tag_v4', '0001_skinny_dagger');

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    // After a successful migration run, the stored tag must equal the latest.
    expect(storageState.get('@taskforceai:sqlite_migration_tag_v4')).toBe(latestMigrationTag);
  });

  it('backfills legacy prompt_queue rows into pending_changes as prompt entries', async () => {
    storageState.set('@taskforceai:sqlite_migration_tag_v4', latestMigrationTag);
    sqliteMasterRows = [
      { name: 'conversations' },
      { name: 'messages' },
      { name: 'pending_changes' },
      { name: 'metadata' },
      { name: 'prompt_queue' },
      { name: 'pending_prompts' },
      { name: 'user_profiles' },
    ];
    promptQueueRows = [
      {
        conversation_id: 'conv-1',
        prompt: 'queued prompt',
        status: 'running',
        created_at: 123,
        model_id: 'openai/gpt-5.5',
        attachment_ids: '["att-1","att-2"]',
      },
    ];

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(runSyncCalls).toContainEqual({
      sql: 'INSERT INTO pending_changes (type, entity_id, operation, data, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [
        'prompt',
        'conv-1',
        'create',
        JSON.stringify({
          prompt: 'queued prompt',
          status: 'queued',
          runPayload: {
            prompt: 'queued prompt',
            demo: false,
            modelId: 'openai/gpt-5.5',
            attachment_ids: ['att-1', 'att-2'],
          },
        }),
        123,
      ],
    });
  });

  it('does not duplicate prompt backfill when matching prompt pending change already exists', async () => {
    storageState.set('@taskforceai:sqlite_migration_tag_v4', latestMigrationTag);
    sqliteMasterRows = [
      { name: 'conversations' },
      { name: 'messages' },
      { name: 'pending_changes' },
      { name: 'metadata' },
      { name: 'prompt_queue' },
      { name: 'pending_prompts' },
      { name: 'user_profiles' },
    ];
    promptQueueRows = [
      {
        conversation_id: 'conv-1',
        prompt: 'queued prompt',
        status: 'queued',
        created_at: 123,
        model_id: null,
        attachment_ids: null,
      },
    ];
    promptPendingChangeRows = [
      {
        entity_id: 'conv-1',
        created_at: 123,
        data: JSON.stringify({ prompt: 'queued prompt', status: 'queued' }),
      },
    ];

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(
      runSyncCalls.some((call) => call.sql.includes('INSERT INTO pending_changes'))
    ).toBe(false);
  });

  it('creates missing tables and repairs post-migration columns as a fallback', async () => {
    storageState.set('@taskforceai:sqlite_migration_tag_v4', latestMigrationTag);

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(execSyncCalls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS conversations'))).toBe(true);
    expect(execSyncCalls).toContain('ALTER TABLE prompt_queue ADD COLUMN attachment_ids TEXT;');
    expect(execSyncCalls).toContain('ALTER TABLE user_profiles ADD COLUMN id INTEGER NOT NULL DEFAULT 0;');
    expect(execSyncCalls).toContain('UPDATE user_profiles SET id = rowid WHERE id = 0;');
  });

  it('bootstraps partial legacy databases and recreates missing user_profiles via fallback', async () => {
    sqliteMasterRows = [
      { name: 'conversations' },
      { name: 'messages' },
      { name: 'metadata' },
      { name: 'prompt_queue' },
      { name: 'pending_changes' },
    ];

    await runDrizzleMigrations({} as any, createMockRawDb() as any);

    expect(migrateCalls).toBe(0);
    expect(storageState.get('@taskforceai:sqlite_migration_tag_v4')).toBe(latestMigrationTag);
    expect(
      execSyncCalls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS user_profiles'))
    ).toBe(true);
  });
});
