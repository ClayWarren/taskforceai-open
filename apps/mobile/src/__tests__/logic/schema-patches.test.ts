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

    applyLegacySchemaPatches(db as any, []);

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

  it('falls back to non-unique indexes if unique index creation fails', () => {
    const { db, execCalls } = createMockDb({
      tables: ['conversations'],
      columnsByTable: {
        conversations: ['conversation_id'],
      },
      throwOnExec: (sql) =>
        sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "conversations_conversation_id_key"'),
    });

    applyLegacySchemaPatches(db as any, []);

    expect(
      execCalls.some((sql) =>
        sql.includes(
          'CREATE INDEX IF NOT EXISTS "conversations_conversation_id_key_nonunique" ON "conversations" ("conversation_id")'
        )
      )
    ).toBe(true);
  });

  it('rolls back rebuild transaction when insert-select fails', () => {
    const { db, execCalls } = createMockDb({
      tables: ['pending_changes'],
      columnsByTable: {
        pending_changes: ['id', 'type', 'entityId', 'operation', 'data', 'createdAt'],
      },
      throwOnExec: (sql) => sql.startsWith('INSERT INTO "pending_changes_new"'),
    });

    applyLegacySchemaPatches(db as any, []);

    expect(execCalls).toContain('BEGIN IMMEDIATE;');
    expect(execCalls).toContain('ROLLBACK;');
    expect(execCalls).toContain('PRAGMA foreign_keys = ON;');
  });

  it('rebuilds every legacy table shape before revalidating indexes', () => {
    const tables = [
      'conversations',
      'messages',
      'auth_sessions',
      'user_profiles',
      'prompt_queue',
      'pending_prompts',
      'pending_changes',
    ];
    const columnsByTable = Object.fromEntries(
      tables.map((table) => [
        table,
        [
          'id',
          'conversation_id',
          'message_id',
          'user_id',
          'email',
          'title',
          'status',
          'role',
          'content',
          'prompt',
          'type',
          'operation',
          'data',
          'created_at',
          'updated_at',
        ],
      ])
    );
    const { db, execCalls } = createMockDb({ tables, columnsByTable });

    applyLegacySchemaPatches(db as any, []);

    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "auth_sessions_new"'))).toBe(true);
    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "user_profiles_new"'))).toBe(true);
    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "prompt_queue_new"'))).toBe(true);
    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "pending_prompts_new"'))).toBe(true);
    expect(execCalls.some((sql) => sql.startsWith('INSERT INTO "pending_changes_new"'))).toBe(true);
    expect(execCalls.some((sql) => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "messages_message_id_key"'))).toBe(
      true
    );
  });
});
