import {
  createSentryMetricsCollector,
  type MetricsCollector,
  type SentryMetricsClient,
} from '@taskforceai/observability/metrics';

type WebMetricsSentry = SentryMetricsClient;

export type WebMetricsCollector = MetricsCollector;

let currentMetrics = createSentryMetricsCollector(null);

export const installSentryMetricsTransport = (sentry: WebMetricsSentry): void => {
  currentMetrics = createSentryMetricsCollector(sentry);
};

export const webMetrics: WebMetricsCollector = {
  incrementCounter(name, tags) {
    currentMetrics.incrementCounter(name, tags);
  },
  startTimer(name, tags) {
    return currentMetrics.startTimer(name, tags);
  },
};
