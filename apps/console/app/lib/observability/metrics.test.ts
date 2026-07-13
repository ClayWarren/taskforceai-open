import { describe, expect, it, vi } from 'bun:test';

import { consoleMetrics, installSentryMetricsTransport } from './metrics';

describe('console metrics', () => {
  it('installs Sentry lazily and forwards subsequent metrics', () => {
    const addBreadcrumb = vi.fn();
    installSentryMetricsTransport({ addBreadcrumb });

    consoleMetrics.incrementCounter('console.test', { route: 'usage' });
    const stopTimer = consoleMetrics.startTimer('console.timer', { route: 'usage' });
    stopTimer();

    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'metrics.counter',
      message: 'console.test',
      level: 'info',
      data: { route: 'usage' },
    });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'metrics.timer',
        message: 'console.timer',
        data: expect.objectContaining({ route: 'usage' }),
      })
    );
  });
});
