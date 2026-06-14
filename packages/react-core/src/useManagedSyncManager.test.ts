import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import type { StorageAdapter } from '@taskforceai/persistence';
import type { SyncClient } from '@taskforceai/sync-client';
import { SyncStatus } from '@taskforceai/sync-client';
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
});
