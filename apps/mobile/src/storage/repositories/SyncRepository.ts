/**
 * Sync Repository - Handles sync-related operations
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { dbManager } from '../database-manager';
import { pendingChanges as pendingChangesTable } from '../schema';
import type { ISyncStore, PendingChange } from '../storage-adapter';
import { serializeJson, safeParseJson, withRepoError } from '../utils';
import { mobileLogger } from '../../logger';

const SYNC_METADATA_KEY = '@taskforceai:sync_metadata';
const SyncMetadataSchema = z.object({
  lastSyncVersion: z.number().optional(),
  lastSyncedAt: z.number().optional(),
});

const PendingChangeTypeSchema = z.enum(['conversation', 'message', 'deletion', 'prompt']);
const PendingChangeOperationSchema = z.enum(['create', 'update', 'delete']);

export class SyncRepository implements ISyncStore {
  async getPendingChanges(): Promise<PendingChange[]> {
    return withRepoError('[SyncRepository] get pending changes', async () => {
      const db = await dbManager.ensureOrm();
      const rows = await db
        .select()
        .from(pendingChangesTable)
        .orderBy(asc(pendingChangesTable.createdAt));

      return rows.map((row) => {
        const typeResult = PendingChangeTypeSchema.safeParse(row.type);
        const opResult = PendingChangeOperationSchema.safeParse(row.operation);

        return {
          id: row.id ?? undefined,
          type: typeResult.success ? typeResult.data : 'conversation',
          entityId: row.entityId,
          operation: opResult.success ? opResult.data : 'update',
          data: safeParseJson(row.data, z.record(z.string(), z.unknown()), {}),
          createdAt: row.createdAt,
        };
      });
    });
  }

  async addPendingChange(change: PendingChange): Promise<void> {
    return withRepoError('[SyncRepository] add pending change', async () => {
      const db = await dbManager.ensureOrm();
      await db.insert(pendingChangesTable).values({
        type: change.type,
        entityId: change.entityId,
        operation: change.operation,
        data: serializeJson(change.data ?? {}) || '{}',
        createdAt: change.createdAt,
      });
    });
  }

  async removePendingChange(id: number): Promise<void> {
    return withRepoError(
      '[SyncRepository] remove pending change',
      async () => {
        const db = await dbManager.ensureOrm();
        await db.delete(pendingChangesTable).where(eq(pendingChangesTable.id, id));
      },
      { id }
    );
  }

  async updatePendingChange(id: number, data: Record<string, unknown>): Promise<void> {
    await this.updatePendingChangeData(id, data);
  }

  async clearPendingChanges(): Promise<void> {
    return withRepoError('[SyncRepository] clear pending changes', async () => {
      const db = await dbManager.ensureOrm();
      await db.delete(pendingChangesTable);
    });
  }

  async updatePendingChangeData(id: number, data: unknown): Promise<void> {
    return withRepoError(
      '[SyncRepository] update pending change data',
      async () => {
        const db = await dbManager.ensureOrm();
        await db
          .update(pendingChangesTable)
          .set({ data: serializeJson(data) || '{}' })
          .where(eq(pendingChangesTable.id, id));
      },
      { id }
    );
  }

  async getLastSyncVersion(): Promise<number> {
    try {
      const metadata = await AsyncStorage.getItem(SYNC_METADATA_KEY);
      if (!metadata) return 0;
      const parsed = safeParseJson(metadata, SyncMetadataSchema, {});
      return parsed.lastSyncVersion ?? 0;
    } catch (error) {
      mobileLogger.warn('[SyncRepository] Failed to get last sync version, returning 0', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  async setLastSyncVersion(version: number): Promise<void> {
    return withRepoError(
      '[SyncRepository] set last sync version',
      async () => {
        const metadata = { lastSyncVersion: version, lastSyncedAt: Date.now() };
        await AsyncStorage.setItem(SYNC_METADATA_KEY, JSON.stringify(metadata));
      },
      { version }
    );
  }
}
