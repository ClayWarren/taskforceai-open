import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  IterableBackoff,
  circuitBreaker,
  handleAll,
  retry,
  wrap,
} from 'cockatiel';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useManagedSyncManager, type SyncState } from '@taskforceai/react-core';
import type { SyncManager as SyncManagerInstance } from '@taskforceai/sync-client';

import { getMobileBaseUrl } from '../config/base-url';
import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import { sqliteStorage } from '../storage/sqlite-adapter';
import { createMobileSyncClient } from '../sync/mobileSyncClient';
import { queryKeys } from './api/queryKeys';
import { useNetworkStatus } from './useNetworkStatus';

const RETRY_DELAYS_MS = [1000, 5000, 15000];
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_TIME = 15 * 60 * 1000;

export interface UseSyncManagerReturn {
  syncState: SyncState;
  sync: (options?: { throwOnError?: boolean }) => Promise<void>;
  isOnline: boolean | null;
}

type AppStateApi = Pick<typeof AppState, 'addEventListener' | 'currentState'>;

export function useSyncManager(
  enabled = true,
  appStateApi: AppStateApi | undefined = AppState
): UseSyncManagerReturn {
  const { isOnline } = useNetworkStatus();
  const [appState, setAppState] = useState<AppStateStatus>(appStateApi?.currentState ?? 'active');
  const [reconnectSignal, setReconnectSignal] = useState(0);
  const sawOnlineRef = useRef(false);
  const queryClient = useQueryClient();

  const resolvedBaseUrl = getMobileBaseUrl();
  const logger = useMemo(
    () => createModuleLogger('useSyncManager', { baseUrl: resolvedBaseUrl }),
    [resolvedBaseUrl]
  );

  const syncPolicy = useMemo(() => {
    const retryPolicy = retry(handleAll, {
      maxAttempts: RETRY_DELAYS_MS.length,
      backoff: new IterableBackoff(RETRY_DELAYS_MS),
    });
    retryPolicy.onRetry((event) => {
      const reason = 'error' in event ? event.error : event.value;
      logger.warn('Retrying sync after failure', {
        attempt: event.attempt,
        delayMs: event.delay,
        reason,
      });
    });

    const breakerPolicy = circuitBreaker(handleAll, {
      breaker: new ConsecutiveBreaker(MAX_CONSECUTIVE_FAILURES),
      halfOpenAfter: CIRCUIT_BREAKER_RESET_TIME,
    });
    breakerPolicy.onBreak((event) => {
      const reason = 'isolated' in event ? 'isolated' : 'error' in event ? event.error : event.value;
      logger.warn('Sync circuit breaker opened', { reason });
    });
    breakerPolicy.onReset(() => {
      logger.info('Sync circuit breaker reset');
    });

    return wrap(retryPolicy, breakerPolicy);
  }, [logger]);

  const createSyncClient = useCallback(
    () =>
      createMobileSyncClient({
        baseUrl: resolvedBaseUrl,
        getToken: async () => {
          const result = await sqliteStorage.getSession();
          return result.ok ? result.value.accessToken : '';
        },
      }),
    [resolvedBaseUrl]
  );

  const runSync = useCallback(
    async (manager: SyncManagerInstance) => {
      const stopTimer = mobileMetrics.startTimer('sync.duration');
      try {
        return await syncPolicy.execute(() => manager.sync());
      } finally {
        stopTimer();
      }
    },
    [syncPolicy]
  );

  const shouldRun = useCallback(async () => {
    const tokenResult = await sqliteStorage.getSession();
    const hasValidToken = tokenResult.ok && tokenResult.value.accessToken.length > 0;
    return enabled && isOnline === true && hasValidToken;
  }, [enabled, isOnline]);

  useEffect(() => {
    if (isOnline !== true) {
      return;
    }
    if (sawOnlineRef.current) {
      setReconnectSignal((signal) => signal + 1);
    }
    sawOnlineRef.current = true;
  }, [isOnline]);

  useEffect(() => {
    if (!appStateApi?.addEventListener) return;
    const subscription = appStateApi.addEventListener('change', (nextAppState) => {
      if (appState.match(/inactive|background/) && nextAppState === 'active') {
        setReconnectSignal((signal) => signal + 1);
      }
      setAppState(nextAppState);
    });
    return () => subscription.remove();
  }, [appState, appStateApi]);

  const manager = useManagedSyncManager({
    enabled,
    storage: sqliteStorage,
    createSyncClient,
    isOnline,
    isActive: appState === 'active',
    shouldRun,
    runSync,
    reconnectSignal,
    onSyncComplete: async (stats) => {
      const itemsSynced =
        stats.pulled.conversations +
        stats.pulled.messages +
        stats.pulled.deletions +
        stats.pushed.conversations +
        stats.pushed.messages +
        stats.pushed.deletions;
      mobileMetrics.incrementCounter('sync.success', {
        itemsSynced,
        conflictsResolved: stats.conflicts,
      });
      logger.info('Sync successful', { stats });
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onSyncError: ({ error, normalizedError }) => {
      const statusValue =
        typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status?: unknown }).status
          : undefined;
      const status = typeof statusValue === 'number' ? statusValue : null;

      if (error instanceof BrokenCircuitError) {
        logger.warn('Sync blocked while circuit breaker is open');
      } else if (status !== null && status >= 500) {
        logger.warn('Sync temporarily unavailable', { status });
      } else {
        logger.error('Sync failed', { error });
      }

      mobileMetrics.incrementCounter('sync.failure', {
        error: normalizedError.message,
      });
    },
    realtime: {
      onConnect: () => {
        logger.info('Connecting to realtime sync');
      },
      onDisconnect: (reason) => {
        if (reason === 'inactive') {
          logger.debug('Disconnecting realtime sync (inactive or offline)');
        }
      },
      onConnectError: (error) => {
        logger.error('Failed to initiate realtime sync connection', { error });
      },
      onDisconnectError: (error, reason) => {
        if (reason === 'cleanup') {
          logger.warn('Error during realtime disconnect cleanup', { error });
          return;
        }
        logger.warn('Error during realtime disconnect', { error });
      },
    },
    logger,
  });

  return { syncState: manager.syncState, sync: manager.sync, isOnline };
}
