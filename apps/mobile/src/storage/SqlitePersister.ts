/**
 * SQLite Persister for TanStack Query
 * 
 * Allows the query cache to be persisted automatically in SQLite
 */
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client';
import { parseJsonSchema } from '@taskforceai/client-core/json/parse';
import { dbManager } from './database-manager';
import { z } from 'zod';
import { createModuleLogger } from '../logger';

const PERSISTENCE_KEY = 'react-query-cache';
const logger = createModuleLogger('SqlitePersister');
const persistedClientSchema = z.object({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.unknown(),
});

export function createSqlitePersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        const db = await dbManager.ensureRawDb();
        const value = JSON.stringify(client);

        try {
          await db.runAsync(
            'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
            [PERSISTENCE_KEY, value],
          );
        } catch {
          await db.runAsync('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
          await db.runAsync(
            'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
            [PERSISTENCE_KEY, value],
          );
        }
      } catch (error) {
        logger.warn('Failed to persist query cache', { error });
      }
    },
    restoreClient: async () => {
      try {
        const db = await dbManager.ensureRawDb();

        let row: { key: string; value: string } | undefined;
        try {
          const result = await db.getFirstAsync<{ key: string; value: string }>(
            'SELECT key, value FROM metadata WHERE key = ?',
            [PERSISTENCE_KEY],
          );
          row = result ?? undefined;
        } catch {
          await db.runAsync('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        }

        if (!row) return undefined;
        const parsed = parseJsonSchema(row.value, persistedClientSchema);
        if (!parsed.ok) {
          logger.warn('Persisted query cache failed validation', { reason: parsed.error });
          return undefined;
        }
        return parsed.value as PersistedClient;
      } catch (error) {
        logger.warn('Failed to restore query cache', { error });
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        const db = await dbManager.ensureRawDb();
        try {
          await db.runAsync('DELETE FROM metadata WHERE key = ?', [PERSISTENCE_KEY]);
        } catch {
          // Table might not exist, ignore
        }
      } catch (error) {
        logger.warn('Failed to remove persisted query cache', { error });
      }
    },
  };
}
