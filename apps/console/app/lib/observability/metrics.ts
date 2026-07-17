import {
  createSentryMetricsCollector,
  type MetricsCollector,
  type SentryMetricsClient,
} from '@taskforceai/observability/metrics';

let currentMetrics = createSentryMetricsCollector(null);

export const installSentryMetricsTransport = (sentry: SentryMetricsClient): void => {
  currentMetrics = createSentryMetricsCollector(sentry);
};

export const consoleMetrics: MetricsCollector = {
  incrementCounter(name, tags) {
    currentMetrics.incrementCounter(name, tags);
  },
  startTimer(name, tags) {
    return currentMetrics.startTimer(name, tags);
  },
};
