import type { BroadcastEvent, SyncClient } from '@taskforceai/sync-client';
import { evaluateRealtimeSyncEvent } from '@taskforceai/sync-client';
import { useCallback, useEffect, useRef } from 'react';

export interface ManagedRealtimeSyncOptions {
  client: Pick<SyncClient, 'connectRealtime'> | null;
  enabled: boolean;
  isSyncing: boolean | (() => boolean);
  onSyncRequired: (eventType: BroadcastEvent['type']) => void | Promise<void>;
  throttleMs?: number;
  recheckIntervalMs?: number;
  onConnect?: () => void;
  onDisconnect?: (reason: 'inactive' | 'cleanup' | 'manual') => void;
  onEvent?: (event: BroadcastEvent) => void;
  onTrigger?: (eventType: BroadcastEvent['type']) => void;
  onSyncError?: (error: unknown, eventType: BroadcastEvent['type']) => void;
  onConnectError?: (error: unknown) => void;
  onDisconnectError?: (error: unknown, reason: 'inactive' | 'cleanup' | 'manual') => void;
}

const DEFAULT_THROTTLE_MS = 3000;
const DEFAULT_RECHECK_INTERVAL_MS = 250;

export const useManagedRealtimeSync = ({
  client,
  enabled,
  isSyncing,
  onSyncRequired,
  throttleMs = DEFAULT_THROTTLE_MS,
  recheckIntervalMs = DEFAULT_RECHECK_INTERVAL_MS,
  onConnect,
  onDisconnect,
  onEvent,
  onTrigger,
  onSyncError,
  onConnectError,
  onDisconnectError,
}: ManagedRealtimeSyncOptions) => {
  const disconnectRef = useRef<(() => void) | null>(null);
  const lastSyncRef = useRef(0);
  const pendingEventRef = useRef<BroadcastEvent | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingSourceRef = useRef(isSyncing);
  const onSyncRequiredRef = useRef(onSyncRequired);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onEventRef = useRef(onEvent);
  const onTriggerRef = useRef(onTrigger);
  const onSyncErrorRef = useRef(onSyncError);
  const onConnectErrorRef = useRef(onConnectError);
  const onDisconnectErrorRef = useRef(onDisconnectError);
  isSyncingSourceRef.current = isSyncing;

  onSyncRequiredRef.current = onSyncRequired;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;
  onEventRef.current = onEvent;
  onTriggerRef.current = onTrigger;
  onSyncErrorRef.current = onSyncError;
  onConnectErrorRef.current = onConnectError;
  onDisconnectErrorRef.current = onDisconnectError;

  const readIsSyncing = useCallback(() => {
    const current = isSyncingSourceRef.current;
    return typeof current === 'function' ? current() : current;
  }, []);

  const disconnectRealtime = useCallback((reason: 'inactive' | 'cleanup' | 'manual') => {
    const hadConnection = disconnectRef.current !== null;
    if (disconnectRef.current) {
      try {
        disconnectRef.current();
      } catch (error) {
        onDisconnectErrorRef.current?.(error, reason);
      }
      disconnectRef.current = null;
    }
    pendingEventRef.current = null;
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (hadConnection) {
      onDisconnectRef.current?.(reason);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !client?.connectRealtime) {
      disconnectRealtime('inactive');
      return;
    }

    if (disconnectRef.current) {
      return;
    }

    const schedulePendingSync = (delayMs: number) => {
      if (pendingTimerRef.current || !pendingEventRef.current) {
        return;
      }
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        processPendingSync();
      }, delayMs);
    };

    const triggerSync = (eventType: BroadcastEvent['type']) => {
      lastSyncRef.current = Date.now();
      onTriggerRef.current?.(eventType);
      void Promise.resolve(onSyncRequiredRef.current(eventType))
        .then(() => {
          if (pendingEventRef.current) {
            if (pendingTimerRef.current) {
              clearTimeout(pendingTimerRef.current);
              pendingTimerRef.current = null;
            }
            processPendingSync();
          }
        })
        .catch((error) => {
          onSyncErrorRef.current?.(error, eventType);
          pendingEventRef.current = null;
          if (pendingTimerRef.current) {
            clearTimeout(pendingTimerRef.current);
            pendingTimerRef.current = null;
          }
        });
    };

    const processPendingSync = () => {
      const pendingEvent = pendingEventRef.current;
      if (!pendingEvent) {
        return;
      }

      const decision = evaluateRealtimeSyncEvent({
        event: pendingEvent,
        now: Date.now(),
        lastSyncAt: lastSyncRef.current,
        throttleMs,
        isSyncing: readIsSyncing(),
        recheckIntervalMs,
      });

      if (decision.action === 'queue') {
        schedulePendingSync(decision.delayMs);
        return;
      }

      pendingEventRef.current = null;
      if (decision.action === 'trigger') {
        triggerSync(pendingEvent.type);
      }
    };

    try {
      disconnectRef.current = client.connectRealtime((event) => {
        if (!event) {
          return;
        }

        onEventRef.current?.(event);
        const decision = evaluateRealtimeSyncEvent({
          event,
          now: Date.now(),
          lastSyncAt: lastSyncRef.current,
          throttleMs,
          isSyncing: readIsSyncing(),
          recheckIntervalMs,
        });

        if (decision.action === 'queue') {
          pendingEventRef.current = event;
          schedulePendingSync(decision.delayMs);
          return;
        }

        if (decision.action === 'trigger') {
          triggerSync(event.type);
        }
      });
      onConnectRef.current?.();
    } catch (error) {
      onConnectErrorRef.current?.(error);
    }

    return () => {
      disconnectRealtime('cleanup');
    };
  }, [client, disconnectRealtime, enabled, readIsSyncing, recheckIntervalMs, throttleMs]);

  return {
    disconnectRealtime,
  };
};
