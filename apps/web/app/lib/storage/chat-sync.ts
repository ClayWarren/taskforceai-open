'use client';

import { createHttpSyncClient, SyncManager } from '@taskforceai/sync-client';
import { dexieStorage } from './dexie-adapter';

let _syncManager: SyncManager | null = null;

export const getSyncManager = (): SyncManager => {
  if (!_syncManager) {
    const syncClient = createHttpSyncClient(
      '',
      () => null // Cookies are used automatically with credentials: 'include'
    );

    _syncManager = new SyncManager({
      storage: dexieStorage,
      syncClient,
      autoSyncInterval: 30000, // Sync every 30 seconds
    });
  }
  return _syncManager;
};

/**
 * Trigger a manual sync.
 */
export const triggerSync = async () => {
  const manager = getSyncManager();
  return manager.sync();
};
