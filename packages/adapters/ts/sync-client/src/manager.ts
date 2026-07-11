import { getSyncLogger } from './logger';
import {
  applyConversationIdMappings,
  applyPendingMessageConversationMappings,
  applyPullResponse,
  buildPushPayload,
  clearAcceptedPendingChanges,
  clearInvalidPendingChanges,
  mapConflicts,
} from './manager-helpers';
import type { SyncManagerConfig, SyncStats } from './manager-types';
import { SyncStatus } from './manager-types';

const extractStatusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
};

const readPullLatestVersion = (response: unknown): number => {
  if (typeof response !== 'object' || response === null) {
    return 0;
  }
  const snakeCase = (response as { latest_version?: unknown }).latest_version;
  if (typeof snakeCase === 'number' && Number.isFinite(snakeCase)) {
    return Math.max(0, Math.trunc(snakeCase));
  }
  const camelCase = (response as { latestVersion?: unknown }).latestVersion;
  if (typeof camelCase === 'number' && Number.isFinite(camelCase)) {
    return Math.max(0, Math.trunc(camelCase));
  }
  return 0;
};

const readConversationIdMappings = (response: unknown): Record<string, number | string> => {
  if (typeof response !== 'object' || response === null) {
    return {};
  }
  const snakeCase = (response as { conversation_id_mappings?: unknown }).conversation_id_mappings;
  if (typeof snakeCase === 'object' && snakeCase !== null) {
    return snakeCase as Record<string, number | string>;
  }
  const camelCase = (response as { conversationIdMappings?: unknown }).conversationIdMappings;
  if (typeof camelCase === 'object' && camelCase !== null) {
    return camelCase as Record<string, number | string>;
  }
  return {};
};

export class SyncManager {
  private static readonly MAX_PULL_BATCHES = 100;
  private status = SyncStatus.IDLE;
  private lastSyncTime = 0;
  private autoSyncTimer?: ReturnType<typeof setInterval>;
  private queuedSyncTimer?: ReturnType<typeof setTimeout>;
  private isSyncing = false;
  private pendingSync = false;
  private destroyed = false;
  private readonly logger = getSyncLogger();

  constructor(private c: SyncManagerConfig) {
    if (c.autoSyncInterval) this.startAutoSync(c.autoSyncInterval);
  }

  async sync(): Promise<SyncStats> {
    if (this.destroyed) {
      return this.empty();
    }
    if (this.isSyncing) {
      this.pendingSync = true;
      this.logger.info('Sync in progress, queuing');
      return this.empty();
    }
    this.isSyncing = true;
    this.status = SyncStatus.SYNCING;
    this.c.onSyncStart?.();
    const start = Date.now(),
      s: SyncStats = this.empty();
    try {
      const devId = await this.c.storage.getDeviceId();
      let requestedVersion = await this.c.storage.getLastSyncVersion();
      let hasMorePullPages = false;
      let paginatedPullBatches = 0;

      /* eslint-disable no-await-in-loop -- Pull pagination is inherently sequential per version cursor. */
      for (let pullBatch = 0; pullBatch < SyncManager.MAX_PULL_BATCHES; pullBatch += 1) {
        paginatedPullBatches = pullBatch + 1;
        const pullResponse = await this.c.syncClient.pull(requestedVersion, devId);
        const pulled = await applyPullResponse(this.c.storage, pullResponse);
        s.pulled.conversations += pulled.conversations;
        s.pulled.messages += pulled.messages;
        s.pulled.deletions += pulled.deletions;

        hasMorePullPages = pullResponse.has_more === true;
        if (!hasMorePullPages) {
          break;
        }

        const nextVersion = readPullLatestVersion(pullResponse);
        if (nextVersion <= requestedVersion) {
          this.logger.error('Paginated pull cursor did not advance while has_more=true', {
            requestedVersion,
            nextVersion,
            pullBatch,
          });
          throw new Error('Sync pull cursor did not advance while additional pages were reported');
        }
        requestedVersion = nextVersion;
      }
      /* eslint-enable no-await-in-loop */

      if (hasMorePullPages) {
        this.logger.error('Paginated pull exceeded batch safety limit', {
          maxPullBatches: SyncManager.MAX_PULL_BATCHES,
          paginatedPullBatches,
          requestedVersion,
        });
        throw new Error(`Sync pull exceeded ${SyncManager.MAX_PULL_BATCHES} pages`);
      }

      await this.pushPendingChanges(s, devId, requestedVersion);
      this.lastSyncTime = Date.now();
      s.duration = this.lastSyncTime - start;
      this.status = SyncStatus.IDLE;
      this.c.onSyncComplete?.(s);
      return s;
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      s.errors = 1;
      s.duration = Date.now() - start;
      this.status = SyncStatus.ERROR;
      this.c.onSyncError?.(error);

      const statusCode = extractStatusCode(e);
      if (statusCode !== null && statusCode >= 500) {
        this.logger.warn('Sync temporarily unavailable', { status: statusCode });
      } else if (!this.c.onSyncError && (statusCode !== 401 || this.c.isProduction !== true)) {
        this.logger.error('Sync failed', { error });
      }
      throw e;
    } finally {
      this.isSyncing = false;
      if (this.pendingSync && !this.destroyed) {
        this.pendingSync = false;
        this.queuedSyncTimer = setTimeout(() => {
          delete this.queuedSyncTimer;
          if (this.destroyed) {
            return;
          }
          void this.sync().catch((err) => {
            this.logger.error('Queued sync failed', { err });
          });
        }, 100);
      } else {
        this.pendingSync = false;
      }
    }
  }

  private async pushPendingChanges(
    stats: SyncStats,
    deviceId: string,
    requestedVersion: number
  ): Promise<void> {
    const pending = await this.c.storage.getPendingChanges();
    if (pending.length === 0) return;

    const payload = await buildPushPayload(pending, deviceId);
    const hasPushPayload =
      payload.conversations.length > 0 ||
      payload.messages.length > 0 ||
      payload.deletions.length > 0;
    const response = hasPushPayload
      ? await this.c.syncClient.push(
          payload.conversations,
          payload.messages,
          payload.deletions,
          deviceId
        )
      : {
          accepted: [],
          conflicts: [],
          new_version: requestedVersion,
          conversation_id_mappings: {},
        };
    const conflicts = Array.isArray(response.conflicts) ? response.conflicts : [];
    if (conflicts.length > 0) {
      const mappedConflicts = mapConflicts({ ...response, conflicts });
      this.c.onConflict?.(mappedConflicts);
      this.logger.warn('Sync conflicts', { count: mappedConflicts.length });
    }

    const conversationIdMappings = readConversationIdMappings(response);
    await applyConversationIdMappings(this.c.storage, conversationIdMappings);
    const retainedInvalidIDs = await applyPendingMessageConversationMappings(
      this.c.storage,
      pending,
      conversationIdMappings
    );
    if (payload.invalidPendingChanges.length > 0) {
      await clearInvalidPendingChanges(
        this.c.storage,
        payload.invalidPendingChanges,
        retainedInvalidIDs
      );
      const clearedCount = payload.invalidPendingChanges.filter(
        (change) => !retainedInvalidIDs.has(change.id)
      ).length;
      if (clearedCount > 0) {
        this.logger.warn('Removed invalid pending sync changes', {
          count: clearedCount,
          retained: retainedInvalidIDs.size,
        });
      }
    }
    await clearAcceptedPendingChanges(
      this.c.storage,
      pending,
      Array.isArray(response.accepted) ? response.accepted : []
    );
    stats.pushed = {
      conversations: payload.conversations.length,
      messages: payload.messages.length,
      deletions: payload.deletions.length,
    };
    stats.conflicts = conflicts.length;
  }

  startAutoSync(ms: number) {
    if (this.destroyed) {
      return;
    }
    this.stopAutoSync();
    this.autoSyncTimer = setInterval(
      () => void this.sync().catch((e) => this.logger.error('Auto-sync failed', { e })),
      ms
    );
  }
  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      delete this.autoSyncTimer;
    }
  }
  getStatus() {
    return { status: this.status, lastSyncTime: this.lastSyncTime, isSyncing: this.isSyncing };
  }
  destroy() {
    this.destroyed = true;
    this.pendingSync = false;
    if (this.queuedSyncTimer) {
      clearTimeout(this.queuedSyncTimer);
      delete this.queuedSyncTimer;
    }
    this.stopAutoSync();
  }
  private empty = (): SyncStats => ({
    duration: 0,
    pulled: { conversations: 0, messages: 0, deletions: 0 },
    pushed: { conversations: 0, messages: 0, deletions: 0 },
    conflicts: 0,
    errors: 0,
  });
}
