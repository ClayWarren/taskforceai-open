import { describe, expect, it, mock } from 'bun:test';

import { createSentryMetricsCollector } from './metrics';

describe('createSentryMetricsCollector', () => {
  it('emits counter and timer breadcrumbs', () => {
    const originalNow = Date.now;
    const addBreadcrumb = mock();

    try {
      Date.now = mock(() => 10_000) as unknown as typeof Date.now;
      const metrics = createSentryMetricsCollector({ addBreadcrumb });

      metrics.incrementCounter('developer.api.request.total', { endpoint: 'usage' });
      const stopTimer = metrics.startTimer('developer.api.request.duration', {
        endpoint: 'usage',
      });

      Date.now = mock(() => 10_075) as unknown as typeof Date.now;
      stopTimer();
    } finally {
      Date.now = originalNow;
    }

    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'metrics.counter',
      message: 'developer.api.request.total',
      data: { endpoint: 'usage' },
      level: 'info',
    });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'metrics.timer',
      message: 'developer.api.request.duration',
      data: { endpoint: 'usage', durationMs: 75 },
      level: 'info',
    });
  });

  it('is a no-op when Sentry is unavailable', () => {
    const metrics = createSentryMetricsCollector(null);

    metrics.incrementCounter('admin.api.request.total');
    expect(() => metrics.startTimer('admin.api.request.duration')()).not.toThrow();
  });
});
