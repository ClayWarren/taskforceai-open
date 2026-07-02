import { describe, expect, it } from 'bun:test';
import { applyLegacySchemaPatches } from '../../storage/schema-patches';

type MockDbOptions = {
  tables: string[];
  columnsByTable?: Record<string, string[]>;
  throwOnExec?: (sql: string) => boolean;
};

type MockDbResult = {
  db: {
    getAllSync: (sql: string) => Array<{ name: string }>;
    execSync: (sql: string) => void;
  };
  execCalls: string[];
};

const createMockDb = (options: MockDbOptions): MockDbResult => {
  const execCalls: string[] = [];

  const db = {
    getAllSync: (sql: string) => {
      if (sql.includes('SELECT name FROM sqlite_master')) {
        return options.tables.map((name) => ({ name }));
      }

      const pragmaMatch = sql.match(/PRAGMA table_info\("([^"]+)"\)/);
      if (pragmaMatch) {
        const table = pragmaMatch[1];
        const columns = options.columnsByTable?.[table] ?? [];
        return columns.map((name) => ({ name }));
      }

      return [];
    },
    execSync: (sql: string) => {
      execCalls.push(sql.trim());
      if (options.throwOnExec?.(sql)) {
        throw new Error(`Injected failure for SQL: ${sql}`);
      }
    },
  };

  return { db, execCalls };
};

describe('schema-patches', () => {
  it('skips rebuild work for configured tables that are absent', () => {
    const { db, execCalls } = createMockDb({
      tables: [],
    });

    const result = applyLegacySchemaPatches(db as any, []);

    expect(execCalls).toEqual(['PRAGMA foreign_keys = OFF;', 'PRAGMA foreign_keys = ON;']);
    expect(result).toEqual({ changed: false, rebuiltTables: [], repairedIndexes: [] });
  });

  it('rebuilds conversations using legacy camelCase and poison-column mappings', () => {
    const { db, execCalls } = createMockDb({
      tables: ['conversations'],
      columnsByTable: {
        conversations: [
          'id',
          'conversationId',
          'userId',
          'title',
          'createdAt',
          'updatedAt',
          'lastMessagePreview',
          'syncVersion',
          'lastSyncedAt',
          'deviceId',
          'obs_is_deleted',
        ],
      },
    });

    const result = applyLegacySchemaPatches(db as any, []);

    const insertSql = execCalls.find((sql) => sql.startsWith('INSERT INTO "conversations_new"'));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain('"conversationId"');
    expect(insertSql).toContain('"obs_is_deleted"');
    expect(insertSql).toContain("''");
    expect(execCalls).toContain('BEGIN IMMEDIATE;');
    expect(execCalls).toContain('COMMIT;');
    expect(execCalls.some((sql) => sql.includes('ALTER TABLE "conversations_new" RENAME TO "conversations"'))).toBe(
      true
    );
    expect(result.rebuiltTables).toEqual(['conversations']);
  });

  it('uses typed defaults and NULL fallbacks when rebuilding missing legacy columns', () => {
    const { db, execCalls } = createMockDb({
      tables: ['user_profiles'],
      columnsByTable: {
        user_profiles: ['email'],
      },
    });

    applyLegacySchemaPatches(db as any, []);

    const insertSql = execCalls.find((sql) => sql.startsWith('INSERT INTO "user_profiles_new"'));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain('rowid');
    expect(insertSql).toContain('"email"');
    expect(insertSql).toContain("''");
    expect(insertSql).toContain('NULL');
  });

  it('falls back to synthetic legacy IDs when message identifiers are missing', () => {
    const { db, execCalls } = createMockDb({
      tables: ['messages'],
      columnsByTable: {
        messages: ['role', 'content', 'created_at', 'updated_at', 'is_streaming'],
      },
    });

    applyLegacySchemaPatches(db as any, []);

    const insertSql = execCalls.find((sql) => sql.startsWith('INSERT INTO "messages_new"'));
    expect(insertSql).toBeDefined();
    const fallbackCount = (insertSql?.match(/'legacy-' \|\| rowid/g) ?? []).length;
    expect(fallbackCount).toBeGreaterThanOrEqual(2);
  });

  it('rebuilds when a legacy poison column replaces a target column', () => {
    const { db, execCalls } = createMockDb({
      tables: ['pending_changes'],
      columnsByTable: {
        pending_changes: [
          'id',
          'type',
          'operation',
          'data',
          'created_at',
          'backup_entity_id',
        ],
      },
    });

    const result = applyLegacySchemaPatches(db as any, []);

    const insertSql = execCalls.find((sql) => sql.startsWith('INSERT INTO "pending_changes_new"'));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain('"backup_entity_id"');
    expect(result.rebuiltTables).toContain('pending_changes');
  });

  it('skips index creation for tables absent from the original schema snapshot', () => {
    const { db, execCalls } = createMockDb({
      tables: ['messages'],
      columnsByTable: {
        messages: ['message_id', 'conversation_id'],
      },
    });

    applyLegacySchemaPatches(db as any, ['messages']);

    expect(
      execCalls.some((sql) => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "messages_message_id_key"'))
    ).toBe(true);
    expect(
      execCalls.some((sql) =>
        sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "conversations_conversation_id_key"')
      )
    ).toBe(false);
  });

  it('dedupes rows and retries unique indexes if unique index creation fails', () => {
    let uniqueIndexAttempts = 0;
    const { db, execCalls } = createMockDb({
      tables: ['conversations'],
      columnsByTable: {
        conversations: [
          'id',
          'conversation_id',
          'user_id',
          'title',
          'status',
          'created_at',
          'updated_at',
          'last_message_preview',
          'sync_version',
          'last_synced_at',
          'device_id',
          'is_deleted',
          'is_archived',
          'error',
        ],
      },
      throwOnExec: (sql) => {
        if (!sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "conversations_conversation_id_key"')) {
          return false;
        }
        uniqueIndexAttempts += 1;
        return uniqueIndexAttempts === 1;
      },
    });

    const result = applyLegacySchemaPatches(db as any, []);

    expect(
      execCalls.some((sql) =>
        sql.includes(
          'DELETE FROM "conversations" WHERE rowid NOT IN (SELECT MIN(rowid) FROM "conversations" GROUP BY "conversation_id")'
        )
      )
    ).toBe(true);
    expect(
      execCalls.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS "conversations_conversation_id_key_nonunique"'))
    ).toBe(false);
    expect(uniqueIndexAttempts).toBe(2);
    expect(result.repairedIndexes).toEqual(['conversations_conversation_id_key']);
  });

  it('rolls back rebuild transaction when insert-select fails', () => {
    const { db, execCalls } = createMockDb({
      tables: ['pending_changes'],
      columnsByTable: {
        pending_changes: ['id', 'type', 'entityId', 'operation', 'data', 'createdAt'],
      },
      throwOnExec: (sql) => sql.startsWith('INSERT INTO "pending_changes_new"'),
    });

    expect(() => applyLegacySchemaPatches(db as any, [])).toThrow('Injected failure');

    expect(execCalls).toContain('BEGIN IMMEDIATE;');
    expect(execCalls).toContain('ROLLBACK;');
    expect(execCalls).toContain('PRAGMA foreign_keys = ON;');
  });

  it('skips modern tables that already contain future migration columns', () => {
    const { db, execCalls } = createMockDb({
      tables: ['conversations'],
      columnsByTable: {
        conversations: [
          'id',
          'conversation_id',
          'user_id',
          'title',
          'status',
          'created_at',
          'updated_at',
          'last_message_preview',
          'sync_version',
          'last_synced_at',
          'device_id',
          'is_deleted',
          'is_archived',
          'error',
          'future_migration_column',
        ],
      },
    });

    const result = applyLegacySchemaPatches(db as any, []);

    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "conversations_new"'))).toBe(false);
    expect(execCalls.some((sql) => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "conversations_conversation_id_key"'))).toBe(
      true
    );
    expect(result.changed).toBe(false);
  });
});
