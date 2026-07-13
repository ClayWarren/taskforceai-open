import { beforeEach, describe, expect, it, mock } from 'bun:test';

const storageState = new Map<string, string>();
let migrateCalls = 0;
let migratedConfig: unknown = null;
const previousMigrationTag = '0000_previous';

mock.module('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storageState.set(key, value);
    },
  },
}));

mock.module('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: async (_orm: unknown, config: unknown) => {
    migrateCalls += 1;
    migratedConfig = config;
  },
}));

mock.module('../../../drizzle/migrations', () => ({
  __esModule: true,
  default: {
    journal: {
      version: '7',
      dialect: 'sqlite',
      entries: [
        {
          idx: 0,
          version: '6',
          when: 1,
          tag: '0001_minimal',
          breakpoints: true,
        },
      ],
    },
  },
}));

mock.module('../../drizzle/migrations', () => ({
  __esModule: true,
  default: {
    journal: {
      version: '7',
      dialect: 'sqlite',
      entries: [
        {
          idx: 0,
          version: '6',
          when: 1,
          tag: '0001_minimal',
          breakpoints: true,
        },
      ],
    },
  },
}));

import { runDrizzleMigrations } from '../../storage/migration-runner';

const createMockRawDb = () => ({
  execSync: () => {},
  getAllSync: (sql: string) => {
    if (sql.includes('sqlite_master')) {
      return [
        { name: 'auth_sessions' },
        { name: 'conversations' },
        { name: 'messages' },
        { name: 'metadata' },
        { name: 'pending_changes' },
        { name: 'pending_prompts' },
        { name: 'prompt_queue' },
        { name: 'user_profiles' },
      ];
    }
    if (sql.includes('__drizzle_migrations')) {
      return [{ id: 1 }];
    }
    if (sql.includes('PRAGMA table_info("prompt_queue")')) {
      return [{ name: 'attachment_ids' }];
    }
    if (sql.includes('PRAGMA table_info("user_profiles")')) {
      return [{ name: 'id' }];
    }
    if (sql.includes('PRAGMA table_info("conversations")')) {
      return [{ name: 'is_archived' }];
    }
    return [];
  },
  runSync: () => {},
});

describe('migration-runner without generated SQL records', () => {
  beforeEach(() => {
    storageState.clear();
    storageState.set('@taskforceai:sqlite_migration_tag_v4', previousMigrationTag);
    migrateCalls = 0;
    migratedConfig = null;
  });

  it('passes configs without migration records through to Drizzle', async () => {
    await runDrizzleMigrations({} as never, createMockRawDb() as never);

    expect(migrateCalls).toBe(1);
    expect(migratedConfig).toEqual({
      journal: {
        version: '7',
        dialect: 'sqlite',
        entries: [
          {
            idx: 0,
            version: '6',
            when: 1,
            tag: '0001_minimal',
            breakpoints: true,
          },
        ],
      },
    });
    expect(storageState.get('@taskforceai:sqlite_migration_tag_v4')).not.toBe(previousMigrationTag);
  });
});
