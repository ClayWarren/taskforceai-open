import { describe, expect, it, mock } from 'bun:test';

mock.module('../../storage/schema-patch-definitions', () => ({
  SCHEMA_REBUILD_CONFIGS: [
    {
      tableName: 'messages',
      createSql: 'CREATE TABLE messages_new',
      mappings: {},
    },
  ],
  SCHEMA_INDEX_CONFIGS: [],
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    error: mock(() => {}),
    warn: mock(() => {}),
  },
}));

describe('schema-patches invalid create sql', () => {
  it('rejects rebuild configs whose CREATE TABLE SQL cannot be parsed', async () => {
    const { applyLegacySchemaPatches } = await import('../../storage/schema-patches');

    expect(() =>
      applyLegacySchemaPatches(
        {
          getAllSync: (sql: string) => {
            if (sql.includes('SELECT name FROM sqlite_master')) {
              return [{ name: 'messages' }];
            }
            if (sql.includes('PRAGMA table_info')) {
              return [{ name: 'message_id' }];
            }
            return [];
          },
          execSync: () => {},
        } as any,
        ['messages']
      )
    ).toThrow('[SchemaPatches] Unable to parse target table columns');
  });
});
