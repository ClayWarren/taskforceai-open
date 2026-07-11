import { beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  createStorageMock,
  pendingChange,
  pullResponse,
  pushResponse,
  syncConversation,
  syncDeletion,
  syncMessage,
} from '#tests/fixtures/sync-storage';
import type { SyncClient } from './client';
import { getSyncLogger } from './logger';
import { SyncManager } from './manager';
import { SyncStatus } from './manager-types';
import type { SyncStats } from './manager-types';

type SyncClientMock = {
  [K in keyof SyncClient]: ReturnType<typeof vi.fn<SyncClient[K]>>;
};

const createSyncClientMock = (): SyncClientMock => ({
  pull: vi.fn<SyncClient['pull']>().mockResolvedValue(pullResponse()),
  push: vi.fn<SyncClient['push']>().mockResolvedValue(pushResponse()),
  getStatus: vi.fn<SyncClient['getStatus']>().mockResolvedValue({
    last_synced_at: new Date().toISOString(),
    sync_version: 0,
    pending_changes: 0,
  }),
  connectRealtime: vi.fn<SyncClient['connectRealtime']>().mockReturnValue(() => {
    /* noop */
  }),
});

describe('SyncManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs pull and push cycle with pending changes', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull.mockResolvedValue(
      pullResponse({
        conversations: [
          syncConversation({ result: 'Result', sync_version: 2, device_id: 'remote-device' }),
        ],
        messages: [syncMessage({ elapsed_seconds: 1, sync_version: 2, device_id: 'remote' })],
        latest_version: 3,
      })
    );

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 10,
        data: { prompt: 'Draft prompt' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:local-1'],
        new_version: 4,
        conversation_id_mappings: { 'local-1': 99 },
      })
    );

    const onComplete = vi.fn();

    const manager = new SyncManager({
      storage,
      syncClient,
      onSyncComplete: onComplete,
    });

    const stats = await manager.sync();

    expect(stats.pulled.conversations).toBe(1);
    expect(stats.pushed.conversations).toBe(1);
    expect(onComplete).toHaveBeenCalled();
    expect(storage.replaceConversationId).toHaveBeenCalledWith('local-1', 'remote-99');
    expect(storage.removePendingChange).toHaveBeenCalledWith(10);
  });

  it('continues pulling while the server reports has_more', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull
      .mockResolvedValueOnce(
        pullResponse({
          conversations: [syncConversation({ user_input: 'first-page', sync_version: 50 })],
          latest_version: 50,
          has_more: true,
        })
      )
      .mockResolvedValueOnce(
        pullResponse({
          conversations: [syncConversation({ id: 2, user_input: 'second-page', sync_version: 51 })],
          latest_version: 51,
          has_more: false,
        })
      );

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(syncClient.pull).toHaveBeenCalledTimes(2);
    expect(stats.pulled.conversations).toBe(2);
    expect(storage.upsertConversation).toHaveBeenCalledTimes(2);
  });

  it('skips truncated-only pull pages and still pushes local changes', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull
      .mockResolvedValueOnce(
        pullResponse({
          conversations: [
            syncConversation({
              user_input: 'oversized',
              sync_version: 12,
              content_truncated: true,
            }),
          ],
          latest_version: 12,
          has_more: true,
        })
      )
      .mockResolvedValueOnce(
        pullResponse({
          latest_version: 12,
          has_more: false,
        })
      );
    storage.getPendingChanges.mockResolvedValue([
      pendingChange({ id: 42, data: { prompt: 'local prompt' } }),
    ]);
    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:local-1'],
        new_version: 13,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(syncClient.pull).toHaveBeenCalledTimes(2);
    expect(storage.upsertConversation).not.toHaveBeenCalled();
    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(12);
    expect(syncClient.push).toHaveBeenCalled();
    expect(storage.removePendingChange).toHaveBeenCalledWith(42);
    expect(stats.pulled.conversations).toBe(0);
    expect(stats.pushed.conversations).toBe(1);
  });

  it('fails when paginated pull reports has_more without advancing latest version', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull
      .mockResolvedValueOnce(
        pullResponse({
          latest_version: 10,
          has_more: true,
        })
      )
      .mockResolvedValueOnce(
        pullResponse({
          latest_version: 10,
          has_more: true,
        })
      );

    const manager = new SyncManager({ storage, syncClient });
    await expect(manager.sync()).rejects.toThrow(
      'Sync pull cursor did not advance while additional pages were reported'
    );
    expect(syncClient.pull).toHaveBeenCalledTimes(2);
  });

  it('fails when paginated pull exceeds the max page safety limit', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();
    let pullCalls = 0;

    syncClient.pull.mockImplementation(async () => {
      pullCalls += 1;
      return pullResponse({
        latest_version: pullCalls,
        has_more: true,
      });
    });

    const manager = new SyncManager({ storage, syncClient });
    await expect(manager.sync()).rejects.toThrow('Sync pull exceeded 100 pages');
    expect(pullCalls).toBe(100);
  });

  it('queues sync when already in progress', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(pullResponse()), 20))
    );

    const manager = new SyncManager({ storage, syncClient });

    const first = manager.sync();
    const second = manager.sync();
    const queuedStats = await second;
    expect(queuedStats.pulled.conversations).toBe(0);
    await first;
  });

  it('supports auto sync timers', async () => {
    vi.useFakeTimers();
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    const manager = new SyncManager({ storage, syncClient });
    const emptyStats: SyncStats = {
      duration: 0,
      pulled: { conversations: 0, messages: 0, deletions: 0 },
      pushed: { conversations: 0, messages: 0, deletions: 0 },
      conflicts: 0,
      errors: 0,
    };
    const syncSpy = vi.spyOn(manager, 'sync').mockResolvedValue(emptyStats);

    manager.startAutoSync(1000);
    vi.advanceTimersByTime(1000);
    expect(syncSpy).toHaveBeenCalled();

    manager.destroy();
    syncSpy.mockRestore();
    vi.useRealTimers();
  });

  it('exposes status getters', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    const manager = new SyncManager({ storage, syncClient });
    expect(manager.getStatus().status).toBe(SyncStatus.IDLE);
    await manager.sync();
    expect(manager.getStatus().status).toBe(SyncStatus.IDLE);
  });

  it('handles deleted conversations and messages from pull', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull.mockResolvedValue(
      pullResponse({
        conversations: [
          syncConversation({
            id: 10,
            user_input: 'Deleted conv',
            device_id: 'device-1',
            is_deleted: true,
          }),
        ],
        messages: [
          syncMessage({
            message_id: 'msg-deleted',
            role: 'user',
            content: 'Deleted',
            elapsed_seconds: 0,
            device_id: 'device-1',
            is_deleted: true,
          }),
        ],
        deletions: [syncDeletion(), syncDeletion({ type: 'message', id: 'msg-del' })],
        latest_version: 5,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(storage.deleteConversation).toHaveBeenCalledWith('remote-10');
    expect(storage.deleteMessage).toHaveBeenCalledWith('msg-deleted');
    expect(storage.deleteConversation).toHaveBeenCalledWith('conv-del');
    expect(storage.deleteMessage).toHaveBeenCalledWith('msg-del');
  });

  it('handles push with deletion changes', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 20,
        type: 'deletion',
        entityId: 'deleted-conv-1',
        operation: 'delete',
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['deletion:deleted-conv-1'],
        new_version: 6,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(stats.pushed.deletions).toBe(1);
    expect(storage.removePendingChange).toHaveBeenCalledWith(20);
  });

  it('does not advance the pull cursor from push response versions', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull.mockResolvedValue(pullResponse({ latest_version: 5 }));
    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 21,
        entityId: 'local-21',
        data: { prompt: 'Local pending conversation' },
      }),
    ]);
    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:local-21'],
        new_version: 99,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(storage.setLastSyncVersion).toHaveBeenCalledWith(5);
    expect(storage.setLastSyncVersion).not.toHaveBeenCalledWith(99);
  });

  it('pushes pending message changes with parsed payload fields', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    const now = Date.now();
    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 22,
        type: 'message',
        entityId: 'msg-local-22',
        data: {
          messageId: 'msg-local-22',
          conversationId: 'remote-42',
          role: 'user',
          content: 'queued message',
          isStreaming: false,
          isAgentStatus: false,
          createdAt: now - 1000,
          updatedAt: now,
          syncVersion: 3,
          lastSyncedAt: now,
          sources: [{ url: 'https://example.com' }],
        },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['message:msg-local-22'],
        new_version: 7,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(stats.pushed.messages).toBe(1);
    expect(syncClient.push).toHaveBeenCalledWith(
      [],
      [
        expect.objectContaining({
          message_id: 'msg-local-22',
          conversation_id: 42,
          role: 'user',
          content: 'queued message',
          sync_version: 3,
          is_deleted: false,
          device_id: 'device-1',
        }),
      ],
      [],
      'device-1'
    );
    expect(storage.removePendingChange).toHaveBeenCalledWith(22);
  });

  it('uses message deletion type when deletion payload indicates message entity', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 23,
        type: 'deletion',
        entityId: 'msg-23',
        operation: 'delete',
        data: { type: 'message' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['deletion:msg-23'],
        new_version: 8,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(syncClient.push).toHaveBeenCalledWith(
      [],
      [],
      [expect.objectContaining({ id: 'msg-23', type: 'message' })],
      'device-1'
    );
  });

  it('uses message deletion type for message delete operations', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 24,
        type: 'message',
        entityId: 'msg-24',
        operation: 'delete',
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['message:msg-24'],
        new_version: 9,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(syncClient.push).toHaveBeenCalledWith(
      [],
      [],
      [expect.objectContaining({ id: 'msg-24', type: 'message' })],
      'device-1'
    );
  });

  it('clears invalid pending message changes that cannot be pushed', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 25,
        type: 'message',
        entityId: 'msg-invalid',
        operation: 'create',
        data: null,
      }),
    ]);

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(syncClient.push).not.toHaveBeenCalled();
    expect(storage.removePendingChange).toHaveBeenCalledWith(25);
    expect(stats.pushed).toEqual({ conversations: 0, messages: 0, deletions: 0 });
  });

  it('retains local-conversation pending messages after applying returned mappings', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 26,
        type: 'conversation',
        entityId: 'local-26',
        operation: 'create',
        data: { prompt: 'Create conversation first' },
      }),
      pendingChange({
        id: 27,
        type: 'message',
        entityId: 'msg-local-27',
        operation: 'create',
        data: {
          messageId: 'msg-local-27',
          conversationId: 'local-26',
          content: 'Send after mapping',
        },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:local-26'],
        conversation_id_mappings: { 'local-26': 126 },
        new_version: 10,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    const stats = await manager.sync();

    expect(stats.pushed).toEqual({ conversations: 1, messages: 0, deletions: 0 });
    expect(storage.updatePendingChangeData).toHaveBeenCalledWith(27, {
      messageId: 'msg-local-27',
      conversationId: 'remote-126',
      conversationLocalId: 'local-26',
      content: 'Send after mapping',
    });
    expect(storage.removePendingChange).toHaveBeenCalledWith(26);
    expect(storage.removePendingChange).not.toHaveBeenCalledWith(27);
  });

  it('handles sync conflicts and calls onConflict callback', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 30,
        entityId: 'conflict-conv',
        operation: 'update',
        data: { prompt: 'Conflicting' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        conflicts: [
          {
            type: 'conversation',
            id: 'conflict-conv',
            client_version: 2,
            server_version: 5,
            reason: 'Version mismatch',
          },
        ],
        new_version: 7,
      })
    );

    const onConflict = vi.fn();
    const manager = new SyncManager({
      storage,
      syncClient,
      onConflict,
    });

    const stats = await manager.sync();

    expect(stats.conflicts).toBe(1);
    expect(onConflict).toHaveBeenCalledWith([
      {
        type: 'conversation',
        id: 'conflict-conv',
        localVersion: 2,
        serverVersion: 5,
        reason: 'Version mismatch',
      },
    ]);
  });

  it('handles ID mapping when local conversation not found', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 40,
        entityId: 'missing-local',
        data: { prompt: 'Missing' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:missing-local'],
        new_version: 8,
        conversation_id_mappings: { 'missing-local': 888 },
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(storage.replaceConversationId).toHaveBeenCalledWith('missing-local', 'remote-888');
  });

  it('pushes remote-prefixed conversation IDs as updates and skips remote remapping responses', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 41,
        entityId: 'remote-5',
        data: { prompt: 'Retry existing conversation' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:5'],
        new_version: 12,
        conversation_id_mappings: { 'remote-5': 99 },
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    const pushArgs = syncClient.push.mock.calls[0];
    const pushedConversations = pushArgs?.[0];
    if (!Array.isArray(pushedConversations)) {
      throw new Error('Expected pushed conversations argument');
    }
    expect(pushedConversations).toHaveLength(1);
    expect(pushedConversations[0]).toMatchObject({
      id: 5,
      user_input: 'Retry existing conversation',
    });
    expect(pushedConversations[0]?.local_id).toBeUndefined();

    expect(storage.replaceConversationId).not.toHaveBeenCalledWith('remote-5', 'remote-99');
    expect(storage.removePendingChange).toHaveBeenCalledWith(41);
  });

  it('only clears accepted pending changes', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    storage.getPendingChanges.mockResolvedValue([
      pendingChange({
        id: 50,
        entityId: 'accepted-1',
        data: { prompt: 'Accepted' },
      }),
      pendingChange({
        id: 51,
        entityId: 'not-accepted',
        data: { prompt: 'Not accepted' },
      }),
    ]);

    syncClient.push.mockResolvedValue(
      pushResponse({
        accepted: ['conversation:accepted-1'],
        new_version: 9,
      })
    );

    const manager = new SyncManager({ storage, syncClient });
    await manager.sync();

    expect(storage.removePendingChange).toHaveBeenCalledWith(50);
    expect(storage.removePendingChange).not.toHaveBeenCalledWith(51);
  });

  it('handles sync error and calls onSyncError', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    syncClient.pull.mockRejectedValue(new Error('Network error'));

    const onSyncError = vi.fn();
    const errorSpy = vi.spyOn(getSyncLogger(), 'error');
    errorSpy.mockClear();
    const manager = new SyncManager({
      storage,
      syncClient,
      onSyncError,
    });

    await expect(manager.sync()).rejects.toThrow('Network error');
    expect(onSyncError).toHaveBeenCalledWith(expect.any(Error));
    expect(errorSpy).not.toHaveBeenCalledWith('Sync failed', expect.anything());
    expect(manager.getStatus().status).toBe(SyncStatus.ERROR);
  });

  it('logs sync errors when no error callback owns reporting', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();
    const error = new Error('Network error');
    const errorSpy = vi.spyOn(getSyncLogger(), 'error');
    errorSpy.mockClear();
    syncClient.pull.mockRejectedValue(error);

    const manager = new SyncManager({ storage, syncClient });

    await expect(manager.sync()).rejects.toThrow('Network error');
    expect(errorSpy).toHaveBeenCalledWith('Sync failed', { error });
  });

  it('stops auto-sync when no timer exists', () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    const manager = new SyncManager({ storage, syncClient });

    // Should not throw when stopping non-existent timer
    manager.stopAutoSync();
    expect(manager.getStatus().status).toBe(SyncStatus.IDLE);
  });

  it('starts auto-sync from constructor', () => {
    vi.useFakeTimers();
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    const manager = new SyncManager({
      storage,
      syncClient,
      autoSyncInterval: 5000,
    });

    const emptyStats: SyncStats = {
      duration: 0,
      pulled: { conversations: 0, messages: 0, deletions: 0 },
      pushed: { conversations: 0, messages: 0, deletions: 0 },
      conflicts: 0,
      errors: 0,
    };
    const syncSpy = vi.spyOn(manager, 'sync').mockResolvedValue(emptyStats);

    vi.advanceTimersByTime(5000);
    expect(syncSpy).toHaveBeenCalled();

    manager.destroy();
    syncSpy.mockRestore();
    vi.useRealTimers();
  });

  it('handles pending sync after completion', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    let callCount = 0;
    syncClient.pull.mockImplementation(
      () =>
        new Promise((resolve) => {
          callCount++;
          setTimeout(
            () => resolve(pullResponse({ latest_version: callCount })),
            callCount === 1 ? 50 : 10
          );
        })
    );

    const manager = new SyncManager({ storage, syncClient });

    // Start first sync
    const first = manager.sync();

    // Immediately try second (should queue)
    const second = manager.sync();
    const secondStats = await second;
    expect(secondStats.pulled.conversations).toBe(0); // Queued returns empty

    await first;

    // Give time for pending sync to trigger
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('does not run a queued sync after destroy', async () => {
    vi.useFakeTimers();
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    let resolveFirstPull!: (response: ReturnType<typeof pullResponse>) => void;
    syncClient.pull.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstPull = resolve;
        })
    );

    const manager = new SyncManager({ storage, syncClient });

    const first = manager.sync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(syncClient.pull).toHaveBeenCalledTimes(1);

    const queued = await manager.sync();
    expect(queued.pulled.conversations).toBe(0);

    manager.destroy();
    resolveFirstPull(pullResponse({ latest_version: 1 }));
    await first;

    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(syncClient.pull).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('runs queued sync after an active sync errors', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();

    let callCount = 0;
    syncClient.pull.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          callCount++;
          setTimeout(
            () => {
              if (callCount === 1) {
                reject(new Error('Network failure'));
                return;
              }
              resolve(pullResponse({ latest_version: 2 }));
            },
            callCount === 1 ? 40 : 10
          );
        })
    );

    const manager = new SyncManager({ storage, syncClient });

    const first = manager.sync().then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );
    const queued = await manager.sync();

    expect(queued.pulled.conversations).toBe(0);

    const firstResult = await first;
    if (firstResult.ok) {
      throw new Error('Expected first sync call to fail');
    }
    expect(firstResult.error).toBeInstanceOf(Error);
    expect((firstResult.error as Error).message).toBe('Network failure');

    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(syncClient.pull).toHaveBeenCalledTimes(2);
  });

  it('logs queued sync failures after the active sync completes', async () => {
    const storage = createStorageMock();
    const syncClient = createSyncClientMock();
    let resolveFirstPull!: (response: ReturnType<typeof pullResponse>) => void;
    const queuedFailure = new Error('queued failed');
    const logger = getSyncLogger();
    const errorSpy = vi.spyOn(logger, 'error');
    syncClient.pull
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPull = resolve;
          })
      )
      .mockRejectedValueOnce(queuedFailure);

    const manager = new SyncManager({ storage, syncClient });
    const first = manager.sync();
    await Promise.resolve();
    await Promise.resolve();
    const queued = await manager.sync();

    expect(queued.pulled.conversations).toBe(0);

    resolveFirstPull(pullResponse({ latest_version: 1 }));
    await first;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(syncClient.pull).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('Queued sync failed', { err: queuedFailure });
    errorSpy.mockRestore();
  });
});
