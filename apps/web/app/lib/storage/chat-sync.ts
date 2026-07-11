'use client';

import { createHttpSyncClient, SyncManager } from '@taskforceai/sync-client';
import { env } from '../config/env';
import { dexieStorage } from './dexie-adapter';

let _syncManager: SyncManager | null = null;

export const getSyncManager = (): SyncManager => {
  if (!_syncManager) {
    const syncClient = createHttpSyncClient(
      '',
      () => null, // Cookies are used automatically with credentials: 'include'
      { isProduction: env.NODE_ENV === 'production' }
    );

    _syncManager = new SyncManager({
      storage: dexieStorage,
      syncClient,
      autoSyncInterval: 30000, // Sync every 30 seconds
      isProduction: env.NODE_ENV === 'production',
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
