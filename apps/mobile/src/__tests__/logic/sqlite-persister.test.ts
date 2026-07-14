import { beforeEach, describe, expect, it, mock } from 'bun:test';

const rawDbState = {
  ensureRawDbCalls: 0,
  runCalls: [] as Array<{ sql: string; params?: unknown[] }>,
  getCalls: [] as Array<{ sql: string; params?: unknown[] }>,
  runQueue: [] as Error[],
  getQueue: [] as Array<{ key: string; value: string } | Error | null>,
  ensureError: null as Error | null,
};

const rawDb = {
  runAsync: async (sql: string, params?: unknown[]) => {
    rawDbState.runCalls.push({ sql, params });
    const error = rawDbState.runQueue.shift();
    if (error) throw error;
  },
  getFirstAsync: async (sql: string, params?: unknown[]) => {
    rawDbState.getCalls.push({ sql, params });
    const next = rawDbState.getQueue.shift() ?? null;
    if (next instanceof Error) throw next;
    return next;
  },
};

const resetRawDbState = () => {
  rawDbState.ensureRawDbCalls = 0;
  rawDbState.runCalls = [];
  rawDbState.getCalls = [];
  rawDbState.runQueue = [];
  rawDbState.getQueue = [];
  rawDbState.ensureError = null;
};

mock.module('../../storage/database-manager', () => ({
  dbManager: {
    ensureRawDb: async () => {
      rawDbState.ensureRawDbCalls += 1;
      if (rawDbState.ensureError) throw rawDbState.ensureError;
      return rawDb;
    },
  },
}));

mock.module('../../logger', () => ({
  createModuleLogger: () => ({
    warn: () => {},
  }),
}));

describe('SqlitePersister', () => {
  beforeEach(() => {
    resetRawDbState();
  });

  describe('createSqlitePersister', () => {
    it('creates persister with required methods', async () => {
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      expect(persister).toHaveProperty('persistClient');
      expect(persister).toHaveProperty('restoreClient');
      expect(persister).toHaveProperty('removeClient');
    });

    it('persister methods are functions', () => {
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      expect(typeof persister.persistClient).toBe('function');
      expect(typeof persister.restoreClient).toBe('function');
      expect(typeof persister.removeClient).toBe('function');
    });

    it('persists the query cache into metadata', async () => {
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();
      const client = {
        timestamp: 123,
        buster: 'v1',
        clientState: { queries: [{ queryKey: ['user'] }] },
      };

      await persister.persistClient(client);

      expect(rawDbState.ensureRawDbCalls).toBe(1);
      expect(rawDbState.runCalls).toEqual([
        {
          sql: 'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
          params: ['react-query-cache', JSON.stringify(client)],
        },
      ]);
    });

    it('creates metadata table and retries when persisting before metadata exists', async () => {
      rawDbState.runQueue.push(new Error('no such table: metadata'));
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();
      const client = {
        timestamp: 456,
        buster: 'v2',
        clientState: { mutations: [] },
      };

      await persister.persistClient(client);

      expect(rawDbState.runCalls).toEqual([
        {
          sql: 'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
          params: ['react-query-cache', JSON.stringify(client)],
        },
        {
          sql: 'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
          params: undefined,
        },
        {
          sql: 'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
          params: ['react-query-cache', JSON.stringify(client)],
        },
      ]);
    });

    it('restores a valid persisted query cache', async () => {
      const client = {
        timestamp: 789,
        buster: 'v3',
        clientState: { queries: [{ queryHash: 'user' }] },
      };
      rawDbState.getQueue.push({
        key: 'react-query-cache',
        value: JSON.stringify(client),
      });
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      await expect(persister.restoreClient()).resolves.toEqual(client);
      expect(rawDbState.getCalls).toEqual([
        {
          sql: 'SELECT key, value FROM metadata WHERE key = ?',
          params: ['react-query-cache'],
        },
      ]);
    });

    it('returns undefined and prepares metadata table when restore runs before metadata exists', async () => {
      rawDbState.getQueue.push(new Error('no such table: metadata'));
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      await expect(persister.restoreClient()).resolves.toBeUndefined();
      expect(rawDbState.runCalls).toEqual([
        {
          sql: 'CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
          params: undefined,
        },
      ]);
    });

    it('returns undefined for invalid persisted cache rows', async () => {
      rawDbState.getQueue.push(
        { key: 'react-query-cache', value: '{bad json' },
        { key: 'react-query-cache', value: JSON.stringify({ timestamp: 1, clientState: {} }) }
      );
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      await expect(persister.restoreClient()).resolves.toBeUndefined();
      await expect(persister.restoreClient()).resolves.toBeUndefined();
    });

    it('removes persisted query cache and ignores missing metadata table', async () => {
      rawDbState.runQueue.push(new Error('no such table: metadata'));
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      await persister.removeClient();

      expect(rawDbState.runCalls).toEqual([
        {
          sql: 'DELETE FROM metadata WHERE key = ?',
          params: ['react-query-cache'],
        },
      ]);
    });

    it('swallows raw database open failures', async () => {
      rawDbState.ensureError = new Error('database unavailable');
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();
      const client = {
        timestamp: 111,
        buster: 'v4',
        clientState: {},
      };

      await expect(persister.persistClient(client)).resolves.toBeUndefined();
      await expect(persister.restoreClient()).resolves.toBeUndefined();
      await expect(persister.removeClient()).resolves.toBeUndefined();
    });
  });
});
