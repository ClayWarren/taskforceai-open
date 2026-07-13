import { useCallback, useRef, useState } from 'react';
import type { SyncStats } from '@taskforceai/sync-client';
import { SyncStatus } from '@taskforceai/sync-client';

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: number;
  isSyncing: boolean;
  lastStats: SyncStats | null;
  error: Error | null;
}

export const createInitialSyncState = (): SyncState => ({
  status: SyncStatus.IDLE,
  lastSyncTime: 0,
  isSyncing: false,
  lastStats: null,
  error: null,
});

export const useSyncStateController = () => {
  const [syncState, setSyncState] = useState<SyncState>(createInitialSyncState);
  const syncStateRef = useRef(syncState);

  const setTrackedSyncState = useCallback((next: SyncState) => {
    syncStateRef.current = next;
    setSyncState(next);
  }, []);

  const patchSyncState = useCallback((patch: Partial<SyncState>) => {
    setSyncState((previous) => {
      const next = { ...previous, ...patch };
      syncStateRef.current = next;
      return next;
    });
  }, []);

  const startSync = useCallback(() => {
    setTrackedSyncState({
      ...syncStateRef.current,
      isSyncing: true,
      error: null,
      status: SyncStatus.SYNCING,
    });
  }, [setTrackedSyncState]);

  const completeSync = useCallback(
    (stats: SyncStats) => {
      setTrackedSyncState({
        ...syncStateRef.current,
        isSyncing: false,
        lastSyncTime: Date.now(),
        lastStats: stats,
        status: SyncStatus.IDLE,
        error: null,
      });
    },
    [setTrackedSyncState]
  );

  const failSync = useCallback(
    (error: Error) => {
      setTrackedSyncState({
        ...syncStateRef.current,
        isSyncing: false,
        status: SyncStatus.ERROR,
        error,
      });
    },
    [setTrackedSyncState]
  );

  return {
    syncState,
    syncStateRef,
    setSyncState: setTrackedSyncState,
    patchSyncState,
    startSync,
    completeSync,
    failSync,
  };
};
