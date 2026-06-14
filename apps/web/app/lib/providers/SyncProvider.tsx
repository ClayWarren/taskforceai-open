'use client';

import React from 'react';
import { SyncProvider as SharedSyncProvider } from '@taskforceai/ui-kit';
import { useSyncManager } from '../hooks/useSyncManager';

export { useSync } from '@taskforceai/ui-kit';

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
