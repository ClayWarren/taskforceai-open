import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { SyncStatus } from '@taskforceai/sync-client';
import '../../../tests/setup/dom';

import { createInitialSyncState, useSyncStateController } from './useSyncStateController';

describe('useSyncStateController', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-26T12:00:00.000Z'));
  });

  it('creates the default idle sync state', () => {
    expect(createInitialSyncState()).toEqual({
      status: SyncStatus.IDLE,
      lastSyncTime: 0,
      isSyncing: false,
      lastStats: null,
      error: null,
    });
  });

  it('tracks sync lifecycle transitions and mirrors the ref', () => {
    const stats = {
      duration: 10,
      pulled: { conversations: 1, messages: 2, deletions: 3 },
      pushed: { conversations: 4, messages: 5, deletions: 6 },
      conflicts: 0,
      errors: 0,
    };
    const failure = new Error('sync failed');
    const { result } = renderHook(() => useSyncStateController());

    act(() => {
      result.current.startSync();
    });

    expect(result.current.syncState.status).toBe(SyncStatus.SYNCING);
    expect(result.current.syncState.isSyncing).toBe(true);
    expect(result.current.syncStateRef.current).toEqual(result.current.syncState);

    act(() => {
      result.current.completeSync(stats);
    });

    expect(result.current.syncState).toEqual({
      status: SyncStatus.IDLE,
      lastSyncTime: Date.parse('2026-03-26T12:00:00.000Z'),
      isSyncing: false,
      lastStats: stats,
      error: null,
    });
    expect(result.current.syncStateRef.current).toEqual(result.current.syncState);

    act(() => {
      result.current.failSync(failure);
    });

    expect(result.current.syncState.status).toBe(SyncStatus.ERROR);
    expect(result.current.syncState.error).toBe(failure);
    expect(result.current.syncStateRef.current).toEqual(result.current.syncState);
  });

  it('sets and patches sync state directly', () => {
    const { result } = renderHook(() => useSyncStateController());
    const replacement = {
      ...createInitialSyncState(),
      status: SyncStatus.ERROR,
      error: new Error('manual failure'),
    };

    act(() => {
      result.current.setSyncState(replacement);
    });

    expect(result.current.syncState).toBe(replacement);
    expect(result.current.syncStateRef.current).toBe(replacement);

    act(() => {
      result.current.patchSyncState({
        status: SyncStatus.SYNCING,
        isSyncing: true,
        error: null,
      });
    });

    expect(result.current.syncState.status).toBe(SyncStatus.SYNCING);
    expect(result.current.syncState.isSyncing).toBe(true);
    expect(result.current.syncState.error).toBeNull();
    expect(result.current.syncStateRef.current).toEqual(result.current.syncState);
  });
});
