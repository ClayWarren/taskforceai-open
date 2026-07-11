/**
 * Mobile Offline Sync Tests
 *
 * Validates queue management, retry tracking, conflict handling, and persistence.
 */
import { describe, it } from '@jest/globals';
import { parseJsonSchema } from '@taskforceai/client-core/json/parse';
import assert from 'node:assert/strict';
import { z } from 'zod';

interface QueuedRequest {
  id: string;
  method: string;
  url: string;
  body?: unknown;
  timestamp: number;
  retries: number;
}

interface SyncState {
  lastSyncTime: number | null;
  pendingRequests: QueuedRequest[];
  conflicts: Array<{ local: unknown; remote: unknown }>;
}

const queuedRequestSchema = z.object({
  id: z.string(),
  method: z.string(),
  url: z.string(),
  body: z.unknown().optional(),
  timestamp: z.number(),
  retries: z.number(),
});

const syncStateSchema = z.object({
  lastSyncTime: z.number().nullable(),
  pendingRequests: z.array(queuedRequestSchema),
  conflicts: z.array(
    z.object({
      local: z.unknown(),
      remote: z.unknown(),
    })
  ),
});

class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }
}

class OfflineSyncManager {
  private storage: MockLocalStorage;
  private syncState: SyncState;
  private readonly SYNC_STATE_KEY = 'taskforceai_sync_state';

  constructor(storage: MockLocalStorage) {
    this.storage = storage;
    this.syncState = this.loadSyncState();
  }

  private loadSyncState(): SyncState {
    const stored = this.storage.getItem(this.SYNC_STATE_KEY);
    if (stored) {
      const parsed = parseJsonSchema(stored, syncStateSchema);
      if (parsed.ok) {
        return parsed.value;
      }
    }
    return {
      lastSyncTime: null,
      pendingRequests: [],
      conflicts: [],
    };
  }

  private saveSyncState(): void {
    this.storage.setItem(this.SYNC_STATE_KEY, JSON.stringify(this.syncState));
  }

  queueRequest(method: string, url: string, body?: unknown): string {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.syncState.pendingRequests.push({
      id,
      method,
      url,
      body,
      timestamp: Date.now(),
      retries: 0,
    });
    this.saveSyncState();
    return id;
  }

  getPendingRequests(): QueuedRequest[] {
    return [...this.syncState.pendingRequests];
  }

  removePendingRequest(id: string): void {
    this.syncState.pendingRequests = this.syncState.pendingRequests.filter((req) => req.id !== id);
    this.saveSyncState();
  }

  incrementRetries(id: string): void {
    const request = this.syncState.pendingRequests.find((req) => req.id === id);
    if (request) {
      request.retries += 1;
      this.saveSyncState();
    }
  }

  updateLastSyncTime(): void {
    this.syncState.lastSyncTime = Date.now();
    this.saveSyncState();
  }

  getLastSyncTime(): number | null {
    return this.syncState.lastSyncTime;
  }

  addConflict(local: unknown, remote: unknown): void {
    this.syncState.conflicts.push({ local, remote });
    this.saveSyncState();
  }

  getConflicts(): Array<{ local: unknown; remote: unknown }> {
    return [...this.syncState.conflicts];
  }

  resolveConflict(index: number): void {
    this.syncState.conflicts.splice(index, 1);
    this.saveSyncState();
  }

  clear(): void {
    this.syncState = {
      lastSyncTime: null,
      pendingRequests: [],
      conflicts: [],
    };
    this.saveSyncState();
  }
}

describe('Offline sync manager', () => {
  it('handles queue persistence, retries, and conflicts', () => {
    const storage = new MockLocalStorage();
    const syncManager = new OfflineSyncManager(storage);

    const reqId1 = syncManager.queueRequest('POST', '/api/v1/run', { prompt: 'Test 1' });
    const reqId2 = syncManager.queueRequest('POST', '/api/v1/run', { prompt: 'Test 2' });
    assert.ok(reqId1);
    assert.ok(reqId2);
    assert.notEqual(reqId1, reqId2);
    assert.equal(syncManager.getPendingRequests().length, 2);

    const storageCopy = new MockLocalStorage();
    storageCopy.setItem('taskforceai_sync_state', storage.getItem('taskforceai_sync_state')!);
    const restoredManager = new OfflineSyncManager(storageCopy);
    assert.equal(restoredManager.getPendingRequests().length, 2);

    syncManager.incrementRetries(reqId1);
    syncManager.incrementRetries(reqId1);
    const retried = syncManager.getPendingRequests().find((req) => req.id === reqId1);
    assert.equal(retried?.retries, 2);

    syncManager.removePendingRequest(reqId1);
    assert.equal(syncManager.getPendingRequests().length, 1);

    syncManager.updateLastSyncTime();
    assert.ok(syncManager.getLastSyncTime());

    syncManager.addConflict(
      { id: 'conv_001', content: 'local change' },
      { id: 'conv_001', content: 'remote change' }
    );
    assert.equal(syncManager.getConflicts().length, 1);
    syncManager.resolveConflict(0);
    assert.equal(syncManager.getConflicts().length, 0);

    syncManager.clear();
    assert.equal(syncManager.getPendingRequests().length, 0);
    assert.equal(syncManager.getConflicts().length, 0);
    assert.equal(syncManager.getLastSyncTime(), null);

  });
});
