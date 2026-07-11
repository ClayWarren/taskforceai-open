'use client';

import React from 'react';
import type { SyncStats, SyncStatus } from '@taskforceai/sync-client';
import {
  SyncProvider as SharedSyncProvider,
  useOptionalSync as useSharedOptionalSync,
  useSync as useSharedSync,
  type SyncContextValue,
} from '@taskforceai/ui-kit/sync/SyncProvider';
import { useSyncManager } from '../hooks/useSyncManager';

type AppSyncContextValue = SyncContextValue<SyncStatus, SyncStats | null>;

export function useSync(): AppSyncContextValue {
  return useSharedSync<SyncStatus, SyncStats | null>();
}

export function useOptionalSync(): AppSyncContextValue | null {
  return useSharedOptionalSync<SyncStatus, SyncStats | null>();
}

export function SyncProvider({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const syncManager = useSyncManager(enabled);
  return (
    <SharedSyncProvider syncManager={syncManager} enabled={enabled}>
      {children}
    </SharedSyncProvider>
  );
}
