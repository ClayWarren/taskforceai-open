'use client';

import { type ReactNode, createContext, useContext } from 'react';

export interface SyncState<TStatus = unknown, TStats = unknown> {
  status: TStatus;
  lastSyncTime: number;
  isSyncing: boolean;
  lastStats: TStats;
  error: Error | null;
}

export interface UseSyncManagerReturn<TStatus = unknown, TStats = unknown> {
  syncState: SyncState<TStatus, TStats>;
  sync: (options?: { throwOnError?: boolean }) => Promise<void>;
  isOnline: boolean | null;
}

export interface SyncContextValue<TStatus = unknown, TStats = unknown> extends UseSyncManagerReturn<
  TStatus,
  TStats
> {
  enabled: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

interface SyncProviderProps<TStatus = unknown, TStats = unknown> {
  children: ReactNode;
  syncManager: UseSyncManagerReturn<TStatus, TStats>;
  enabled?: boolean;
}

/**
 * Provider component that manages sync state and operations
 */
export function SyncProvider<TStatus = unknown, TStats = unknown>({
  children,
  syncManager,
  enabled = true,
}: SyncProviderProps<TStatus, TStats>) {
  return (
    <SyncContext.Provider value={{ ...syncManager, enabled }}>{children}</SyncContext.Provider>
  );
}

/**
 * Hook to access sync functionality from any component
 */
export function useSync<TStatus = unknown, TStats = unknown>(): SyncContextValue<TStatus, TStats> {
  const context = useContext(SyncContext);

  if (!context) {
    throw new Error('useSync must be used within SyncProvider');
  }

  return context as SyncContextValue<TStatus, TStats>;
}

export function useOptionalSync<TStatus = unknown, TStats = unknown>(): SyncContextValue<
  TStatus,
  TStats
> | null {
  return useContext(SyncContext) as SyncContextValue<TStatus, TStats> | null;
}
