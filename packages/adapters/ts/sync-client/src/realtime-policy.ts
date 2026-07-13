import type { BroadcastEvent } from './types';

export const isUrgentRealtimeSyncEvent = (event: BroadcastEvent): boolean =>
  event.type === 'sync:required';

export const isRelevantRealtimeSyncEvent = (event: BroadcastEvent): boolean =>
  isUrgentRealtimeSyncEvent(event) ||
  event.type.startsWith('conversation') ||
  event.type.startsWith('message');

export interface EvaluateRealtimeSyncEventOptions {
  event: BroadcastEvent;
  now: number;
  lastSyncAt: number;
  throttleMs: number;
  isSyncing: boolean;
  recheckIntervalMs: number;
}

export type RealtimeSyncDecision =
  | { action: 'ignore' }
  | { action: 'trigger' }
  | { action: 'queue'; delayMs: number };

export const evaluateRealtimeSyncEvent = ({
  event,
  now,
  lastSyncAt,
  throttleMs,
  isSyncing,
  recheckIntervalMs,
}: EvaluateRealtimeSyncEventOptions): RealtimeSyncDecision => {
  if (!isRelevantRealtimeSyncEvent(event)) {
    return { action: 'ignore' };
  }

  if (isSyncing) {
    return { action: 'queue', delayMs: recheckIntervalMs };
  }

  if (isUrgentRealtimeSyncEvent(event)) {
    return { action: 'trigger' };
  }

  const elapsed = now - lastSyncAt;
  if (elapsed < throttleMs) {
    return { action: 'queue', delayMs: Math.max(0, throttleMs - elapsed) };
  }

  return { action: 'trigger' };
};
