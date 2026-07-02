import { definedProps } from '@taskforceai/shared/utils/object';

export type SentryMetricsClient = {
  addBreadcrumb: (breadcrumb: {
    category: string;
    message: string;
    data?: Record<string, unknown>;
    level?: 'info';
  }) => void;
};

export type MetricsCollector = {
  incrementCounter(name: string, tags?: Record<string, unknown>): void;
  startTimer(name: string, tags?: Record<string, unknown>): () => void;
};

export const createSentryMetricsCollector = (
  sentry: SentryMetricsClient | null | undefined
): MetricsCollector => ({
  incrementCounter(name, tags) {
    sentry?.addBreadcrumb({
      category: 'metrics.counter',
      message: name,
      level: 'info',
      ...definedProps({ data: tags }),
    });
  },
  startTimer(name, tags) {
    const startedAt = Date.now();
    return () => {
      sentry?.addBreadcrumb({
        category: 'metrics.timer',
        message: name,
        data: {
          ...tags,
          durationMs: Date.now() - startedAt,
        },
        level: 'info',
      });
    };
  },
});
