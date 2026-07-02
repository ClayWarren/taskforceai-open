'use client';

import { type ReactNode, createContext, useContext } from 'react';

export interface SyncState {
  status: unknown;
  lastSyncTime: number;
  isSyncing: boolean;
  lastStats: any;
  error: Error | null;
}

export interface UseSyncManagerReturn {
  syncState: SyncState;
  sync: (options?: { throwOnError?: boolean }) => Promise<void>;
  isOnline: boolean | null;
}

interface SyncContextValue extends UseSyncManagerReturn {
  enabled: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

interface SyncProviderProps {
  children: ReactNode;
  syncManager: UseSyncManagerReturn;
  enabled?: boolean;
}

/**
 * Provider component that manages sync state and operations
 */
export function SyncProvider({ children, syncManager, enabled = true }: SyncProviderProps) {
  return (
    <SyncContext.Provider value={{ ...syncManager, enabled }}>{children}</SyncContext.Provider>
  );
}

/**
 * Hook to access sync functionality from any component
 */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);

  if (!context) {
    throw new Error('useSync must be used within SyncProvider');
  }

  return context;
}

export function useOptionalSync(): SyncContextValue | null {
  return useContext(SyncContext);
}
