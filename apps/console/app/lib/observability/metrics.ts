import * as Sentry from '@sentry/react';
import { createSentryMetricsCollector } from '@taskforceai/observability/metrics';

export const consoleMetrics = createSentryMetricsCollector(Sentry);
