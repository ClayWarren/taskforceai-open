'use client';

import { getStoredToken } from '@taskforceai/contracts/auth/auth-storage';
import { getCsrfToken } from '@taskforceai/contracts/auth/csrf';
import { isRetryableError } from '@taskforceai/shared/errors';
import {
  createHttpSyncClient,
  type SyncClient,
  type SyncManager as SyncManagerInstance,
} from '@taskforceai/sync-client';
import { useManagedSyncManager, type SyncState } from '@taskforceai/react-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logger } from '../logger';
import { webMetrics } from '../observability/metrics';
import { usePlatformRuntime, useStorageAdapter } from '../platform/PlatformProvider';
import { getBrowserOrigin } from '../platform/browser-context';
import { createDesktopSyncClient } from '../platform/desktop/sync-client';
import { useAuth } from '../providers/AuthProvider';
import {
  generateRecoveredDeviceId,
  isSyncUnauthorizedError,
  isUnprocessableSyncError,
  toSyncManagerError,
} from './sync-manager-errors';

const SYNC_INTERVAL = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 5000, 15000];

export interface UseSyncManagerReturn {
  syncState: SyncState;
  sync: (options?: { throwOnError?: boolean }) => Promise<void>;
  isOnline: boolean;
}

function useBrowserOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [onlineGeneration, setOnlineGeneration] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleOnline = () => {
      setIsOnline(true);
      setOnlineGeneration((generation) => generation + 1);
      logger.info('Network online, triggering sync');
    };
    const handleOffline = () => {
      setIsOnline(false);
      logger.info('Network offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, onlineGeneration };
}

export function useSyncManager(enabled = true): UseSyncManagerReturn {
  const storageAdapter = useStorageAdapter();
  const runtime = usePlatformRuntime();
  const { handleAuthFailure, isAuthenticated, isTokenReady } = useAuth();
  const { isOnline, onlineGeneration } = useBrowserOnlineStatus();
  const handleAuthFailureRef = useRef(handleAuthFailure);

  useEffect(() => {
    handleAuthFailureRef.current = handleAuthFailure;
  }, [handleAuthFailure]);

  const createSyncClient = useCallback((): SyncClient => {
    const getToken = () => {
      const tokenResult = getStoredToken();
      return tokenResult.ok ? tokenResult.value : null;
    };
    const handleUnauthorized = (source: string) => {
      logger.warn('Sync client unauthorized', { source });
      void handleAuthFailureRef.current?.(`sync_${source}`);
    };
    const originResult = getBrowserOrigin();
    const origin = originResult.ok ? originResult.value : '';
    const options = {
      onUnauthorized: ({ source }: { source: string }) => handleUnauthorized(source),
      getCsrfToken,
      metrics: webMetrics,
    };

    return runtime === 'desktop'
      ? createDesktopSyncClient(origin, getToken, options)
      : createHttpSyncClient('', getToken, options);
  }, [runtime]);

  const retry = useMemo(
    () => ({
      delaysMs: RETRY_DELAYS_MS,
      shouldRetry: (error: unknown) => isRetryableError(error) !== false,
      onRetry: ({
        attempt,
        delayMs,
        error,
      }: {
        attempt: number;
        delayMs: number;
        error: Error;
      }) => {
        logger.warn('Retrying sync after failure', { attempt, delayMs, reason: error });
      },
      onExhausted: ({ error, sourceError }: { error: Error; sourceError: Error }) => {
        logger.error('Sync failed after all retries or non-retryable error', {
          error,
          sourceError,
        });
      },
    }),
    []
  );

  const recovery = useMemo(
    () => ({
      shouldRecover: isUnprocessableSyncError,
      recover: async ({ manager }: { manager: SyncManagerInstance }) => {
        logger.warn('Sync payload rejected (422), attempting local sync metadata recovery');
        await storageAdapter.setLastSyncVersion(0);
        await storageAdapter.setDeviceId(generateRecoveredDeviceId());
        await manager.sync();
        logger.info('Sync recovery succeeded after resetting metadata');
      },
      onFailed: (error: unknown) => {
        logger.error('Sync recovery failed after 422', error);
      },
    }),
    [storageAdapter]
  );

  const manager = useManagedSyncManager({
    enabled,
    storage: storageAdapter,
    createSyncClient,
    autoSyncInterval: SYNC_INTERVAL,
    isOnline,
    reconnectSignal: onlineGeneration,
    normalizeError: toSyncManagerError,
    retry,
    recovery,
    beforeManualSync: () => {
      if (!isOnline) {
        throw new Error('Cannot sync while offline');
      }
    },
    onSyncStart: () => {
      logger.debug('Sync started');
    },
    onSyncComplete: (stats) => {
      const changesSent =
        stats.pushed.conversations + stats.pushed.messages + stats.pushed.deletions;
      const changesReceived =
        stats.pulled.conversations + stats.pulled.messages + stats.pulled.deletions;
      logger.info('Sync completed', {
        durationMs: Math.round(stats.duration),
        changesSent,
        changesReceived,
        conflicts: stats.conflicts,
      });
    },
    onSyncError: ({ error, normalizedError }) => {
      logger.error('Sync failed', { error: normalizedError });
      if (isSyncUnauthorizedError(normalizedError)) {
        logger.info('Sync disabled: user not authenticated', { reason: 'unauthorized' });
        void handleAuthFailureRef.current?.('sync_unauthorized_error');
        return;
      }
      if (isRetryableError(error) === false) {
        logger.error('Sync failed with non-retryable error', { error });
      }
    },
    onInitialSyncError: (_error, normalizedError) => {
      if (!isSyncUnauthorizedError(normalizedError) || !import.meta.env.PROD) {
        logger.error('Initial sync failed', normalizedError);
      }
    },
    onConflict: (conflicts) => {
      logger.warn('Sync conflicts detected', { count: conflicts.length });
    },
    realtime: {
      enabled: Boolean(isAuthenticated && isTokenReady),
      onConnect: () => {
        logger.info('Connecting to real-time sync');
      },
      onDisconnect: (reason) => {
        if (reason === 'cleanup') {
          logger.info('Disconnecting from real-time sync');
        }
      },
      onEvent: (event) => {
        logger.info('Real-time sync event received', { type: event.type });
      },
      onTrigger: (eventType) => {
        logger.info('Triggered real-time sync', { type: eventType });
      },
      onConnectError: (error) => {
        logger.error('Failed to connect to real-time sync', { error });
      },
    },
    logger,
  });

  logger.debug('Real-time sync connection check', {
    enabled,
    isAuthenticated,
    hasToken: isTokenReady,
    isOnline,
  });

  return {
    syncState: manager.syncState,
    sync: manager.sync,
    isOnline,
  };
}
