import {
  SyncManager,
  type ConflictInfo,
  type SyncClient,
  type SyncManagerConfig,
  type SyncStats,
} from '@taskforceai/sync-client';
import type { StorageAdapter } from '@taskforceai/persistence';
import { definedProps } from '@taskforceai/shared/utils/object';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useManagedRealtimeSync } from './useManagedRealtimeSync';
import { useManagedSyncRunner } from './useManagedSyncRunner';
import { type SyncState, useSyncStateController } from './useSyncStateController';

type Logger = {
  info?: (message: string, metadata?: unknown) => void;
  error?: (message: string, metadata?: unknown) => void;
};

type RetryOptions = {
  delaysMs: number[];
  shouldRetry: (error: unknown, normalizedError: Error) => boolean;
  onRetry?: (payload: { attempt: number; delayMs: number; error: Error }) => void;
  onExhausted?: (payload: { error: Error; sourceError: Error }) => void;
};

type RecoveryOptions = {
  shouldRecover: (error: Error) => boolean;
  recover: (payload: { manager: SyncManager; error: Error }) => Promise<void>;
  onFailed?: (error: unknown) => void;
};

type RealtimeOptions = {
  enabled?: boolean;
  onConnect?: () => void;
  onDisconnect?: (reason: 'inactive' | 'cleanup' | 'manual') => void;
  onEvent?: Parameters<typeof useManagedRealtimeSync>[0]['onEvent'];
  onTrigger?: Parameters<typeof useManagedRealtimeSync>[0]['onTrigger'];
  onSyncError?: Parameters<typeof useManagedRealtimeSync>[0]['onSyncError'];
  onConnectError?: (error: unknown) => void;
  onDisconnectError?: (error: unknown, reason: 'inactive' | 'cleanup' | 'manual') => void;
};

export interface ManagedSyncManagerOptions {
  enabled: boolean;
  storage: StorageAdapter;
  createSyncClient: () => SyncClient;
  autoSyncInterval?: number;
  isOnline: boolean | null;
  isActive?: boolean;
  shouldRun?: () => boolean | Promise<boolean>;
  beforeManualSync?: () => void | Promise<void>;
  runSync?: (manager: SyncManager) => Promise<SyncStats>;
  normalizeError?: (error: unknown) => Error;
  initialSync?: boolean;
  reconnectSignal?: unknown;
  syncOnReconnect?: boolean;
  realtime?: RealtimeOptions;
  retry?: RetryOptions;
  recovery?: RecoveryOptions;
  onSyncStart?: () => void;
  onSyncComplete?: (stats: SyncStats) => void | Promise<void>;
  onSyncError?: (payload: {
    error: unknown;
    normalizedError: Error;
    manager: SyncManager;
  }) => void | Promise<void>;
  onInitialSyncError?: (error: unknown, normalizedError: Error) => void;
  onConflict?: (conflicts: ConflictInfo[]) => void;
  onClientReady?: (client: SyncClient | null) => void;
  logger?: Logger;
}

export interface ManagedSyncManagerState {
  syncState: SyncState;
  sync: (options?: { throwOnError?: boolean }) => Promise<void>;
}

const defaultNormalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const useLatestRef = <T>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export function useManagedSyncManager({
  enabled,
  storage,
  createSyncClient,
  autoSyncInterval,
  isOnline,
  isActive = true,
  shouldRun,
  beforeManualSync,
  runSync,
  normalizeError = defaultNormalizeError,
  initialSync = true,
  reconnectSignal,
  syncOnReconnect = true,
  realtime,
  retry,
  recovery,
  onSyncStart,
  onSyncComplete,
  onSyncError,
  onInitialSyncError,
  onConflict,
  onClientReady,
  logger,
}: ManagedSyncManagerOptions): ManagedSyncManagerState {
  const { syncState, syncStateRef, startSync, completeSync, failSync } = useSyncStateController();
  const managerRef = useRef<SyncManager | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const recoveryAttemptedRef = useRef(false);
  const lastInitialGenerationRef = useRef(0);
  const [client, setClient] = useState<SyncClient | null>(null);
  const [generation, setGeneration] = useState(0);

  const runSyncRef = useLatestRef(runSync);
  const normalizeErrorRef = useLatestRef(normalizeError);
  const retryRef = useLatestRef(retry);
  const recoveryRef = useLatestRef(recovery);
  const onSyncStartRef = useLatestRef(onSyncStart);
  const onSyncCompleteRef = useLatestRef(onSyncComplete);
  const onSyncErrorRef = useLatestRef(onSyncError);
  const onInitialSyncErrorRef = useLatestRef(onInitialSyncError);
  const onConflictRef = useLatestRef(onConflict);
  const onClientReadyRef = useLatestRef(onClientReady);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
  }, []);

  const executeManagerSync = useCallback(
    (manager: SyncManager) => (runSyncRef.current ? runSyncRef.current(manager) : manager.sync()),
    [runSyncRef]
  );

  const scheduleRetry = useCallback(
    (manager: SyncManager, sourceError: Error) => {
      const retryConfig = retryRef.current;
      if (!retryConfig || retryTimerRef.current) {
        return;
      }

      const delay = retryConfig.delaysMs[retryAttemptRef.current];
      if (delay === undefined) {
        retryConfig.onExhausted?.({ error: sourceError, sourceError });
        return;
      }

      const attempt = retryAttemptRef.current + 1;
      retryAttemptRef.current = attempt;
      retryConfig.onRetry?.({ attempt, delayMs: delay, error: sourceError });
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void executeManagerSync(manager).catch((error) => {
          const normalizedError = normalizeErrorRef.current(error);
          const currentRetryConfig = retryRef.current;
          if (currentRetryConfig?.shouldRetry(error, normalizedError)) {
            scheduleRetry(manager, normalizedError);
            return;
          }
          currentRetryConfig?.onExhausted?.({ error: normalizedError, sourceError });
        });
      }, delay);
    },
    [executeManagerSync, normalizeErrorRef, retryRef]
  );

  useEffect(() => {
    if (!enabled) {
      managerRef.current = null;
      setClient(null);
      onClientReadyRef.current?.(null);
      lastInitialGenerationRef.current = 0;
      return undefined;
    }

    const syncClient = createSyncClient();
    const managerConfig: SyncManagerConfig = {
      storage,
      syncClient,
      onSyncStart: () => {
        startSync();
        onSyncStartRef.current?.();
      },
      onSyncComplete: (stats) => {
        clearRetryTimer();
        completeSync(stats);
        void onSyncCompleteRef.current?.(stats);
      },
      onSyncError: (error) => {
        const normalizedError = normalizeErrorRef.current(error);
        failSync(normalizedError);
        void onSyncErrorRef.current?.({ error, normalizedError, manager });

        const recoveryConfig = recoveryRef.current;
        if (recoveryConfig?.shouldRecover(normalizedError)) {
          if (!recoveryAttemptedRef.current) {
            recoveryAttemptedRef.current = true;
            clearRetryTimer();
            void recoveryConfig
              .recover({ manager, error: normalizedError })
              .catch((recoveryError) => {
                recoveryConfig.onFailed?.(recoveryError);
                failSync(normalizeErrorRef.current(recoveryError));
              });
          }
          return;
        }

        const retryConfig = retryRef.current;
        if (!retryConfig?.shouldRetry(error, normalizedError)) {
          clearRetryTimer();
          return;
        }
        scheduleRetry(manager, normalizedError);
      },
      ...definedProps({
        autoSyncInterval,
        onConflict: (conflicts: ConflictInfo[]) => {
          onConflictRef.current?.(conflicts);
        },
      }),
    };
    const manager = new SyncManager(managerConfig);

    managerRef.current = manager;
    setClient(syncClient);
    setGeneration((current) => current + 1);
    onClientReadyRef.current?.(syncClient);

    return () => {
      manager.destroy();
      clearRetryTimer();
      if (managerRef.current === manager) {
        managerRef.current = null;
        setClient(null);
        onClientReadyRef.current?.(null);
      }
    };
  }, [
    autoSyncInterval,
    clearRetryTimer,
    completeSync,
    createSyncClient,
    enabled,
    failSync,
    onClientReadyRef,
    onConflictRef,
    onSyncCompleteRef,
    onSyncErrorRef,
    onSyncStartRef,
    recoveryRef,
    retryRef,
    scheduleRetry,
    startSync,
    storage,
    normalizeErrorRef,
  ]);

  const sync = useManagedSyncRunner({
    isSyncing: () => syncStateRef.current.isSyncing,
    runSync: async () => {
      if (!managerRef.current) {
        throw new Error('Sync manager not initialized');
      }
      return executeManagerSync(managerRef.current);
    },
    ...definedProps({
      shouldRun,
      beforeRun: beforeManualSync,
    }),
  });

  useEffect(() => {
    if (!enabled || !initialSync || generation <= 0 || !managerRef.current) {
      return;
    }
    if (lastInitialGenerationRef.current === generation) {
      return;
    }
    lastInitialGenerationRef.current = generation;

    void executeManagerSync(managerRef.current).catch((error) => {
      onInitialSyncErrorRef.current?.(error, normalizeErrorRef.current(error));
    });
  }, [
    enabled,
    executeManagerSync,
    generation,
    initialSync,
    normalizeErrorRef,
    onInitialSyncErrorRef,
  ]);

  useEffect(() => {
    if (!enabled || !syncOnReconnect || !reconnectSignal || !managerRef.current) {
      return;
    }
    if (syncStateRef.current.isSyncing) {
      // coverage-ignore-line -- concurrency guard; runner-level isSyncing behavior is tested separately.
      return;
    }
    void sync();
  }, [enabled, reconnectSignal, sync, syncOnReconnect, syncStateRef]);

  useManagedRealtimeSync({
    client,
    enabled:
      enabled && realtime?.enabled !== false && isOnline === true && isActive && client !== null,
    isSyncing: () => syncStateRef.current.isSyncing,
    onSyncRequired: (eventType) => {
      logger?.info?.('Realtime-triggered sync', { type: eventType });
      return sync({ throwOnError: true });
    },
    onSyncError:
      realtime?.onSyncError ??
      ((error, eventType) =>
        logger?.error?.('Realtime-triggered sync failed', { error, eventType })),
    ...definedProps({
      onConnect: realtime?.onConnect,
      onDisconnect: realtime?.onDisconnect,
      onEvent: realtime?.onEvent,
      onTrigger: realtime?.onTrigger,
      onConnectError: realtime?.onConnectError,
      onDisconnectError: realtime?.onDisconnectError,
    }),
  });

  return { syncState, sync };
}
