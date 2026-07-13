import { describe, expect, it, mock } from 'bun:test';

mock.module('../../storage/schema-patch-definitions', () => ({
  SCHEMA_REBUILD_CONFIGS: [
    {
      tableName: 'messages;DROP TABLE messages',
      createSql: 'CREATE TABLE "messages_new" ("id" INTEGER)',
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

describe('schema-patches unsafe identifiers', () => {
  it('rejects unsafe table names from rebuild configs', async () => {
    const { applyLegacySchemaPatches } = await import('../../storage/schema-patches');

    expect(() =>
      applyLegacySchemaPatches(
        {
          getAllSync: () => [{ name: 'messages;DROP TABLE messages' }],
          execSync: () => {},
        } as any,
        ['messages;DROP TABLE messages']
      )
    ).toThrow('[SchemaPatches] Invalid table name: messages;DROP TABLE messages');
  });
});
