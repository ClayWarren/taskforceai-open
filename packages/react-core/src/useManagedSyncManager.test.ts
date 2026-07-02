import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import type { StorageAdapter } from '@taskforceai/persistence';
import type { SyncClient } from '@taskforceai/sync-client';
import { SyncStatus } from '@taskforceai/sync-client';
import { pendingChange } from '#tests/fixtures/sync-storage';
import { useManagedSyncManager } from './useManagedSyncManager';

const createStorage = (): StorageAdapter => ({
  getConversations: vi.fn(async () => []),
  getConversation: vi.fn(async () => ({ ok: false as const, error: new Error('not found') })),
  upsertConversation: vi.fn(async () => undefined),
  deleteConversation: vi.fn(async () => undefined),
  replaceConversationId: vi.fn(async () => undefined),
  getMessages: vi.fn(async () => []),
  getMessage: vi.fn(async () => ({ ok: false as const, error: new Error('not found') })),
  upsertMessage: vi.fn(async () => undefined),
  deleteMessage: vi.fn(async () => undefined),
  getPendingChanges: vi.fn(async () => []),
  addPendingChange: vi.fn(async () => undefined),
  updatePendingChange: vi.fn(async () => undefined),
  removePendingChange: vi.fn(async () => undefined),
  clearPendingChanges: vi.fn(async () => undefined),
  updatePendingChangeData: vi.fn(async () => undefined),
  getLastSyncVersion: vi.fn(async () => 0),
  setLastSyncVersion: vi.fn(async () => undefined),
  getDeviceId: vi.fn(async () => 'device-1'),
  setDeviceId: vi.fn(async () => undefined),
  clearAll: vi.fn(async () => undefined),
});

const createClient = (overrides: Partial<SyncClient> = {}): SyncClient => ({
  pull: vi.fn(async () => ({
    conversations: [],
    messages: [],
    deletions: [],
    latest_version: 0,
  })),
  push: vi.fn(async () => ({
    accepted: [],
    conflicts: [],
    new_version: 0,
    conversation_id_mappings: {},
  })),
  getStatus: vi.fn(async () => ({
    last_synced_at: new Date(0).toISOString(),
    sync_version: 0,
    pending_changes: 0,
  })),
  connectRealtime: vi.fn(() => vi.fn()),
  ...overrides,
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useManagedSyncManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a manager, runs initial sync, and records successful manual sync state', async () => {
    const storage = createStorage();
    const client = createClient();
    const createSyncClient = vi.fn(() => client);
    const onSyncComplete = vi.fn();

    const { result } = renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        onSyncComplete,
      })
    );

    await act(async () => {
      await flush();
    });

    expect(client.pull).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.sync({ throwOnError: true });
    });

    expect(client.pull).toHaveBeenCalledTimes(2);
    expect(result.current.syncState.status).toBe(SyncStatus.IDLE);
    expect(result.current.syncState.lastStats).toEqual(
      expect.objectContaining({
        pulled: { conversations: 0, messages: 0, deletions: 0 },
        pushed: { conversations: 0, messages: 0, deletions: 0 },
        conflicts: 0,
        errors: 0,
      })
    );
    expect(onSyncComplete).toHaveBeenCalled();
  });

  it('does not recreate the manager when the conflict callback identity changes', async () => {
    const storage = createStorage();
    const client = createClient();
    const createSyncClient = vi.fn(() => client);

    const { rerender } = renderHook(
      ({ onConflict }: { onConflict: () => void }) =>
        useManagedSyncManager({
          enabled: true,
          storage,
          createSyncClient,
          isOnline: true,
          onConflict,
        }),
      { initialProps: { onConflict: vi.fn() } }
    );

    await act(async () => {
      await flush();
    });

    expect(createSyncClient).toHaveBeenCalledTimes(1);
    expect(client.pull).toHaveBeenCalledTimes(1);

    rerender({ onConflict: vi.fn() });

    await act(async () => {
      await flush();
    });

    expect(createSyncClient).toHaveBeenCalledTimes(1);
    expect(client.pull).toHaveBeenCalledTimes(1);
  });

  it('skips initialization while disabled and throws on manual sync', async () => {
    const storage = createStorage();
    const createSyncClient = vi.fn(() => createClient());
    const { result } = renderHook(() =>
      useManagedSyncManager({
        enabled: false,
        storage,
        createSyncClient,
        isOnline: true,
      })
    );

    expect(createSyncClient).not.toHaveBeenCalled();
    await expect(result.current.sync({ throwOnError: true })).rejects.toThrow(
      'Sync manager not initialized'
    );
  });

  it('connects realtime and syncs from realtime events', async () => {
    let realtimeHandler: Parameters<SyncClient['connectRealtime']>[0] | null = null;
    const storage = createStorage();
    const client = createClient({
      connectRealtime: vi.fn((handler) => {
        realtimeHandler = handler;
        return vi.fn();
      }),
    });
    const createSyncClient = vi.fn(() => client);

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
      })
    );

    await act(async () => {
      await flush();
    });
    (client.pull as ReturnType<typeof vi.fn>).mockClear();

    act(() => {
      realtimeHandler?.({ type: 'sync:required', userId: 'user-1' });
    });
    await act(async () => {
      await flush();
    });

    expect(client.connectRealtime).toHaveBeenCalledTimes(1);
    expect(client.pull).toHaveBeenCalledTimes(1);
  });

  it('skips reconnect sync while a sync is already active', async () => {
    let resolvePull!: () => void;
    const storage = createStorage();
    const client = createClient({
      pull: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<SyncClient['pull']>>>((resolve) => {
            resolvePull = () =>
              resolve({
                conversations: [],
                messages: [],
                deletions: [],
                latest_version: 0,
              });
          })
      ),
    });
    const createSyncClient = vi.fn(() => client);

    const { result, rerender } = renderHook(
      ({ reconnectSignal }: { reconnectSignal: number }) =>
        useManagedSyncManager({
          enabled: true,
          storage,
          createSyncClient,
          isOnline: true,
          initialSync: false,
          reconnectSignal,
        }),
      { initialProps: { reconnectSignal: 0 } }
    );

    await act(async () => {
      await flush();
    });

    let syncPromise!: Promise<void>;
    await act(async () => {
      syncPromise = result.current.sync({ throwOnError: true });
      await flush();
    });

    expect(result.current.syncState.isSyncing).toBe(true);

    rerender({ reconnectSignal: 1 });
    await act(async () => {
      await flush();
    });

    expect(client.pull).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePull();
      await syncPromise;
      await flush();
    });
  });

  it('logs realtime-triggered sync failures by default', async () => {
    let realtimeHandler: Parameters<SyncClient['connectRealtime']>[0] | null = null;
    const failure = new Error('realtime pull failed');
    const storage = createStorage();
    const client = createClient({
      pull: vi.fn(async () => {
        throw failure;
      }),
      connectRealtime: vi.fn((handler) => {
        realtimeHandler = handler;
        return vi.fn();
      }),
    });
    const createSyncClient = vi.fn(() => client);
    const logger = { info: vi.fn(), error: vi.fn() };

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        initialSync: false,
        logger,
      })
    );

    act(() => {
      realtimeHandler?.({
        type: 'message:created',
        userId: 'user-1',
        conversationId: 1,
        messageId: 'message-1',
      });
    });
    await act(async () => {
      await flush();
    });

    expect(logger.error).toHaveBeenCalledWith('Realtime-triggered sync failed', {
      error: failure,
      eventType: 'message:created',
    });
  });

  it('runs recovery once for recoverable sync errors', async () => {
    const storage = createStorage();
    const failure = Object.assign(new Error('invalid payload'), { status: 422 });
    const client = createClient({
      pull: vi.fn().mockRejectedValue(failure),
    });
    const createSyncClient = vi.fn(() => client);
    const recover = vi.fn(async () => undefined);

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        normalizeError: (error) => (error instanceof Error ? error : new Error(String(error))),
        recovery: {
          shouldRecover: (error) => (error as { status?: number }).status === 422,
          recover,
        },
      })
    );

    await act(async () => {
      await flush();
    });

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('schedules retries for retryable sync failures', async () => {
    const storage = createStorage();
    const client = createClient({
      pull: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('server failed'), { status: 500 }))
        .mockResolvedValue({
          conversations: [],
          messages: [],
          deletions: [],
          latest_version: 0,
        }),
    });
    const createSyncClient = vi.fn(() => client);

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        retry: {
          delaysMs: [1000],
          shouldRetry: (error) => (error as { status?: number }).status === 500,
        },
      })
    );

    await act(async () => {
      await flush();
    });
    expect(client.pull).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });

    expect(client.pull).toHaveBeenCalledTimes(2);
  });

  it('reports retry exhaustion when retry attempts keep failing', async () => {
    const storage = createStorage();
    const firstFailure = Object.assign(new Error('server failed'), { status: 500 });
    const retryFailure = Object.assign(new Error('server still failed'), { status: 500 });
    const onRetry = vi.fn();
    const onExhausted = vi.fn();
    const client = createClient({
      pull: vi.fn().mockRejectedValueOnce(firstFailure).mockRejectedValueOnce(retryFailure),
    });
    const createSyncClient = vi.fn(() => client);

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        retry: {
          delaysMs: [1000],
          shouldRetry: (error) => (error as { status?: number }).status === 500,
          onRetry,
          onExhausted,
        },
      })
    );

    await act(async () => {
      await flush();
    });

    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      error: firstFailure,
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });

    expect(client.pull).toHaveBeenCalledTimes(2);
    expect(onExhausted).toHaveBeenCalledWith({
      error: retryFailure,
      sourceError: retryFailure,
    });
  });

  it('clears pending retry timers on cleanup', async () => {
    const storage = createStorage();
    const failure = Object.assign(new Error('server failed'), { status: 500 });
    const client = createClient({
      pull: vi.fn().mockRejectedValue(failure),
    });
    const createSyncClient = vi.fn(() => client);
    const onRetry = vi.fn();

    const { unmount } = renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        retry: {
          delaysMs: [1000],
          shouldRetry: (error) => (error as { status?: number }).status === 500,
          onRetry,
        },
      })
    );

    await act(async () => {
      await flush();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });

    expect(client.pull).toHaveBeenCalledTimes(1);
  });

  it('reports retry exhaustion when a retry fails with a non-retryable error', async () => {
    const storage = createStorage();
    const firstFailure = Object.assign(new Error('server failed'), { status: 500 });
    const retryFailure = Object.assign(new Error('bad request'), { status: 400 });
    const onExhausted = vi.fn();
    const client = createClient({
      pull: vi.fn().mockRejectedValueOnce(firstFailure).mockRejectedValueOnce(retryFailure),
    });
    const createSyncClient = vi.fn(() => client);

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        retry: {
          delaysMs: [1000, 1000],
          shouldRetry: (error) => (error as { status?: number }).status === 500,
          onExhausted,
        },
      })
    );

    await act(async () => {
      await flush();
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await flush();
    });

    expect(onExhausted).toHaveBeenCalledWith({
      error: retryFailure,
      sourceError: firstFailure,
    });
  });

  it('forwards sync conflicts from the manager config', async () => {
    const storage = createStorage();
    (storage.getPendingChanges as ReturnType<typeof vi.fn>).mockResolvedValue([
      pendingChange({
        id: 30,
        entityId: 'conflict-conv',
        operation: 'update',
        data: { prompt: 'Conflicting' },
      }),
    ]);
    const client = createClient({
      push: vi.fn(async () => ({
        accepted: [],
        conflicts: [
          {
            type: 'conversation' as const,
            id: 'conflict-conv',
            client_version: 2,
            server_version: 5,
            reason: 'Version mismatch',
          },
        ],
        new_version: 7,
        conversation_id_mappings: {},
      })),
    });
    const createSyncClient = vi.fn(() => client);
    const onConflict = vi.fn();

    renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        onConflict,
      })
    );

    await act(async () => {
      await flush();
    });

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

  it('records recovery failures through the sync state', async () => {
    const storage = createStorage();
    const syncFailure = Object.assign(new Error('invalid payload'), { status: 422 });
    const recoveryFailure = new Error('recovery failed');
    const onFailed = vi.fn();
    const client = createClient({
      pull: vi.fn().mockRejectedValue(syncFailure),
    });
    const createSyncClient = vi.fn(() => client);

    const { result } = renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        recovery: {
          shouldRecover: (error) => (error as { status?: number }).status === 422,
          recover: vi.fn(async () => {
            throw recoveryFailure;
          }),
          onFailed,
        },
      })
    );

    await act(async () => {
      await flush();
    });

    expect(onFailed).toHaveBeenCalledWith(recoveryFailure);
    expect(result.current.syncState.status).toBe(SyncStatus.ERROR);
    expect(result.current.syncState.error).toBe(recoveryFailure);
  });

  it('destroys the manager and reports null client on cleanup', async () => {
    const storage = createStorage();
    const disconnectRealtime = vi.fn();
    const client = createClient({
      connectRealtime: vi.fn(() => disconnectRealtime),
    });
    const createSyncClient = vi.fn(() => client);
    const onClientReady = vi.fn();

    const { unmount } = renderHook(() =>
      useManagedSyncManager({
        enabled: true,
        storage,
        createSyncClient,
        isOnline: true,
        initialSync: false,
        onClientReady,
      })
    );

    await act(async () => {
      await flush();
    });

    expect(onClientReady).toHaveBeenCalledWith(client);

    unmount();

    expect(disconnectRealtime).toHaveBeenCalledTimes(1);
    expect(onClientReady).toHaveBeenLastCalledWith(null);
  });
});
