'use client';

import { SyncStatus } from '@taskforceai/sync-client';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '../../lib/logger';
import { useSync } from '../../lib/providers/SyncProvider';
import { formatRelativeSyncTime } from '@taskforceai/shared/time/display-format';
import { Button } from '@taskforceai/ui-kit';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@taskforceai/ui-kit';

/**
 * Sync Status Indicator - Shows current sync state in the UI
 */

interface SyncStatusIndicatorProps {
  showButton?: boolean;
  showLastSynced?: boolean;
}

const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Displays sync status and optionally a manual sync button
 */
export function SyncStatusIndicator({
  showButton = true,
  showLastSynced = true,
}: SyncStatusIndicatorProps) {
  const { syncState, sync, isOnline } = useSync();
  const [isSyncRequestInFlight, setIsSyncRequestInFlight] = useState(false);

  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncRequestInFlightRef = useRef(false);
  const runRetryRef = useRef<() => Promise<boolean>>(async () => false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const resetRetryState = useCallback(() => {
    retryAttemptRef.current = 0;
    clearRetryTimer();
  }, [clearRetryTimer]);

  const scheduleRetry = useCallback(
    (source: 'manual' | 'retry' | 'state', error: unknown) => {
      if (!isOnline || retryTimerRef.current || retryAttemptRef.current >= MAX_RETRY_ATTEMPTS) {
        return;
      }

      const attempt = retryAttemptRef.current + 1;
      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      retryAttemptRef.current = attempt;

      logger.warn('Scheduling sync retry', {
        source,
        attempt,
        delayMs,
        error,
      });

      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void runRetryRef.current();
      }, delayMs);
    },
    [isOnline]
  );

  const executeSync = useCallback(
    async (source: 'manual' | 'retry') => {
      if (!isOnline || syncState.isSyncing || isSyncRequestInFlightRef.current) {
        return false;
      }

      isSyncRequestInFlightRef.current = true;
      setIsSyncRequestInFlight(true);

      try {
        await sync();
        resetRetryState();
        return true;
      } catch (error) {
        logger.error('Sync attempt failed', {
          source,
          attempt: retryAttemptRef.current + 1,
          error,
        });
        scheduleRetry(source, error);
        return false;
      } finally {
        isSyncRequestInFlightRef.current = false;
        setIsSyncRequestInFlight(false);
      }
    },
    [isOnline, resetRetryState, scheduleRetry, sync, syncState.isSyncing]
  );

  runRetryRef.current = () => executeSync('retry');

  useEffect(() => {
    if (!isOnline || syncState.status !== SyncStatus.ERROR || syncState.isSyncing) {
      return;
    }

    scheduleRetry('state', syncState.error);
  }, [isOnline, scheduleRetry, syncState.error, syncState.isSyncing, syncState.status]);

  useEffect(() => {
    if (!isOnline || syncState.status !== SyncStatus.ERROR) {
      resetRetryState();
    }
  }, [isOnline, resetRetryState, syncState.status]);

  useEffect(() => {
    return () => {
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  const handleSync = async () => {
    if (syncState.isSyncing || !isOnline || isSyncRequestInFlightRef.current) {
      return;
    }

    resetRetryState();
    await executeSync('manual');
  };

  const isSyncBusy = syncState.isSyncing || isSyncRequestInFlight;

  const getStatusColor = () => {
    if (!isOnline) return 'text-gray-400';
    if (syncState.status === SyncStatus.ERROR) return 'text-red-500';
    if (isSyncBusy) return 'text-blue-500';
    return 'text-green-500';
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (syncState.status === SyncStatus.ERROR) return 'Sync error';
    if (isSyncBusy) return 'Syncing...';
    return 'Synced';
  };

  const getLastSyncedText = () => {
    if (!syncState.lastSyncTime) return 'Never synced';
    return formatRelativeSyncTime(syncState.lastSyncTime);
  };

  const getTooltipContent = () => {
    if (!isOnline) return 'Device is offline';
    if (syncState.status === SyncStatus.ERROR)
      return `Sync error: ${syncState.error?.message || 'Unknown error'}`;
    if (isSyncBusy) return 'Syncing your data...';
    if (syncState.lastSyncTime) return `Last synced: ${getLastSyncedText()}`;
    return 'Connected to sync service';
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 text-sm">
        {/* Status indicator with tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex cursor-help items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${getStatusColor().replace('text-', 'bg-')}`} />
              <span className={getStatusColor()}>{getStatusText()}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{getTooltipContent()}</p>
            {syncState.lastStats && (
              <div className="mt-2 space-y-1 text-xs">
                <p>Last sync: {syncState.lastStats.duration}ms</p>
                <p>
                  Pulled: {syncState.lastStats.pulled.conversations}c,{' '}
                  {syncState.lastStats.pulled.messages}m
                </p>
                <p>
                  Pushed: {syncState.lastStats.pushed.conversations}c,{' '}
                  {syncState.lastStats.pushed.messages}m
                </p>
              </div>
            )}
          </TooltipContent>
        </Tooltip>

        {/* Last synced time */}
        {showLastSynced && syncState.lastSyncTime > 0 && (
          <span className="text-xs text-muted-foreground">{getLastSyncedText()}</span>
        )}

        {/* Manual sync button */}
        {showButton && (
          <Button
            onClick={() => {
              void handleSync();
            }}
            disabled={isSyncBusy || !isOnline}
            size="sm"
            variant="outline"
            className="h-8"
          >
            {isSyncBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing
              </>
            ) : (
              'Sync'
            )}
          </Button>
        )}

        {/* Error indicator with tooltip */}
        {syncState.error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-xs text-red-500">⚠️</span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-red-400">{syncState.error.message}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
