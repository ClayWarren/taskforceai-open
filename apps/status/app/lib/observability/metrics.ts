import * as Sentry from '@sentry/react';
import { createSentryMetricsCollector } from '@taskforceai/observability/metrics';

export const statusMetrics = createSentryMetricsCollector(Sentry);
