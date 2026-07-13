import { describe, expect, it, mock } from 'bun:test';

import { installSentryMetricsTransport, webMetrics } from './metrics';

describe('webMetrics', () => {
  it('forwards counters and timers to Sentry breadcrumbs', () => {
    const originalNow = Date.now;
    const addBreadcrumb = mock();

    try {
      Date.now = mock(() => 1_000) as unknown as typeof Date.now;
      installSentryMetricsTransport({ addBreadcrumb });

      webMetrics.incrementCounter('sync.client.request.success', {
        endpoint: 'pull',
        method: 'POST',
      });

      Date.now = mock(() => 1_250) as unknown as typeof Date.now;
      const stopTimer = webMetrics.startTimer('sync.client.request.duration', {
        endpoint: 'pull',
      });
      Date.now = mock(() => 1_375) as unknown as typeof Date.now;
      stopTimer();
    } finally {
      Date.now = originalNow;
    }

    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'metrics.counter',
      message: 'sync.client.request.success',
      data: { endpoint: 'pull', method: 'POST' },
      level: 'info',
    });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'metrics.timer',
      message: 'sync.client.request.duration',
      data: { endpoint: 'pull', durationMs: 125 },
      level: 'info',
    });
  });
});
