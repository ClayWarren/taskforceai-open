import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentryState = {
  breadcrumbs: [] as Array<Record<string, unknown>>,
};

const loggerState = {
  debugCalls: [] as Array<{ message: string; tags?: Record<string, unknown> }>,
};

mock.module('@sentry/react-native', () => ({
  __esModule: true,
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => {
    sentryState.breadcrumbs.push(breadcrumb);
  },
}));

mock.module('../../logger', () => ({
  mobileLogger: {
    debug: (message: string, tags?: Record<string, unknown>) => {
      loggerState.debugCalls.push({ message, tags });
    },
  },
}));

describe('mobile metrics', () => {
  beforeEach(() => {
    sentryState.breadcrumbs = [];
    loggerState.debugCalls = [];
  });

  it('emits Sentry breadcrumbs for counters', async () => {
    const { mobileMetrics } = await import('../../observability/metrics');

    mobileMetrics.incrementCounter('sync.success', { source: 'manual' });

    expect(sentryState.breadcrumbs).toEqual([
      {
        category: 'metrics.counter',
        message: 'sync.success',
        data: { source: 'manual' },
        level: 'info',
      },
    ]);
    expect(loggerState.debugCalls).toContainEqual({
      message: '[Metric] Counter: sync.success',
      tags: { source: 'manual' },
    });
  });

  it('emits timer breadcrumbs with measured durations', async () => {
    const originalDateNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
      const { mobileMetrics } = await import('../../observability/metrics');

      const stopTimer = mobileMetrics.startTimer('db.init.duration', { coldStart: true });
      now = 1_125;
      stopTimer();

      expect(sentryState.breadcrumbs).toEqual([
        {
          category: 'metrics.timer',
          message: 'db.init.duration',
          data: {
            coldStart: true,
            duration_ms: 125,
          },
          level: 'info',
        },
      ]);
      expect(loggerState.debugCalls).toEqual([
        {
          message: '[Metric] Timer Start: db.init.duration',
          tags: { coldStart: true },
        },
        {
          message: '[Metric] Timer End: db.init.duration (125ms)',
          tags: { coldStart: true },
        },
      ]);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('reuses the singleton metrics instance across imports', async () => {
    const first = await import('../../observability/metrics');
    const second = await import('../../observability/metrics');

    expect(first.mobileMetrics).toBe(second.mobileMetrics);
  });
});
