import { describe, expect, it } from 'bun:test';

import { pendingPromptStatusColor, summarizePendingPrompts } from './pending-prompts';

describe('pending prompt summary', () => {
  it('summarizes queued, pending, and failed prompts', () => {
    const summary = summarizePendingPrompts([
      { status: 'queued' },
      { status: 'pending' },
      { status: 'failed' },
    ]);

    expect(summary).toEqual({
      totalCount: 3,
      queuedCount: 1,
      pendingCount: 1,
      failedCount: 1,
      primaryStatus: 'failed',
      savedTitle: '3 prompts saved',
      statusLabel: '1 failed',
      webQueueLabel: '1 message queued, 1 processing',
      failedRetryLabel: '1 message failed to send. Will retry when online.',
    });
  });

  it('uses plural labels and pending priority without failures', () => {
    const summary = summarizePendingPrompts([
      { status: 'queued' },
      { status: 'queued' },
      { status: 'pending' },
      { status: 'unknown' },
    ]);

    expect(summary.primaryStatus).toBe('pending');
    expect(summary.savedTitle).toBe('4 prompts saved');
    expect(summary.statusLabel).toBe('1 pending');
    expect(summary.webQueueLabel).toBe('2 messages queued, 1 processing');
    expect(summary.failedRetryLabel).toBeNull();
  });

  it('maps primary statuses to shared accent colors', () => {
    expect(pendingPromptStatusColor('failed')).toBe('#f87171');
    expect(pendingPromptStatusColor('pending')).toBe('#fbbf24');
    expect(pendingPromptStatusColor('queued')).toBe('#60a5fa');
  });
});
