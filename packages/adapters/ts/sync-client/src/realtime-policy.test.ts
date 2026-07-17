import { describe, expect, it } from 'bun:test';

import {
  evaluateRealtimeSyncEvent,
  isRelevantRealtimeSyncEvent,
  isUrgentRealtimeSyncEvent,
} from './realtime-policy';

describe('realtime-policy', () => {
  it('identifies urgent and relevant events', () => {
    expect(isUrgentRealtimeSyncEvent({ type: 'sync:required' })).toBe(true);
    expect(isUrgentRealtimeSyncEvent({ type: 'connected', connectionId: 'c1' })).toBe(false);
    expect(
      isRelevantRealtimeSyncEvent({
        type: 'conversation:created',
        userId: 'u1',
        conversationId: 1,
      })
    ).toBe(true);
    expect(
      isRelevantRealtimeSyncEvent({
        type: 'message:updated',
        userId: 'u1',
        conversationId: 1,
        messageId: 'm1',
      })
    ).toBe(true);
    expect(isRelevantRealtimeSyncEvent({ type: 'connected', connectionId: 'c1' })).toBe(false);
  });

  it('queues while a sync is already in flight', () => {
    expect(
      evaluateRealtimeSyncEvent({
        event: { type: 'message:created', userId: 'u1', conversationId: 1, messageId: 'm1' },
        now: 10_000,
        lastSyncAt: 9_000,
        throttleMs: 3_000,
        isSyncing: true,
        recheckIntervalMs: 250,
      })
    ).toEqual({ action: 'queue', delayMs: 250 });
  });

  it('bypasses throttling for urgent sync events', () => {
    expect(
      evaluateRealtimeSyncEvent({
        event: { type: 'sync:required' },
        now: 10_000,
        lastSyncAt: 9_500,
        throttleMs: 3_000,
        isSyncing: false,
        recheckIntervalMs: 250,
      })
    ).toEqual({ action: 'trigger' });
  });

  it('queues non-urgent events inside the throttle window', () => {
    expect(
      evaluateRealtimeSyncEvent({
        event: { type: 'conversation:updated', userId: 'u1', conversationId: 1 },
        now: 10_000,
        lastSyncAt: 8_500,
        throttleMs: 3_000,
        isSyncing: false,
        recheckIntervalMs: 250,
      })
    ).toEqual({ action: 'queue', delayMs: 1_500 });
  });

  it('ignores irrelevant events', () => {
    expect(
      evaluateRealtimeSyncEvent({
        event: { type: 'connected', connectionId: 'c1' },
        now: 10_000,
        lastSyncAt: 8_500,
        throttleMs: 3_000,
        isSyncing: false,
        recheckIntervalMs: 250,
      })
    ).toEqual({ action: 'ignore' });
  });
});
