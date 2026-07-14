import { StartClient } from '@tanstack/react-start/client';
import { hydrateRoot } from 'react-dom/client';
import { parseSampleRate } from '@taskforceai/config/env-parsing';
import { configureClientIdFactory } from '@taskforceai/client-runtime';
import { configureLatencyReporter } from '@taskforceai/react-core';
import { scheduleBrowserClientSentryInit } from '@taskforceai/observability/browser-client-sentry';
import { createId } from '@taskforceai/system-runtime/id';
import { reportOptionalLatencyMark } from './lib/observability/latency';

configureClientIdFactory(createId);
configureLatencyReporter(reportOptionalLatencyMark);

const sentryDsn = import.meta.env['VITE_SENTRY_DSN'];
const mode = import.meta.env['MODE'] ?? 'development';
const defaultTracesSampleRate = mode === 'production' ? 0.1 : 0;
const defaultReplaysOnErrorSampleRate = mode === 'production' ? 1.0 : 0;
const tracesSampleRate = parseSampleRate(
  import.meta.env['VITE_SENTRY_TRACES_SAMPLE_RATE'],
  defaultTracesSampleRate
);
const replaysSessionSampleRate = parseSampleRate(
  import.meta.env['VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE'],
  0
);
const replaysOnErrorSampleRate = parseSampleRate(
  import.meta.env['VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE'],
  defaultReplaysOnErrorSampleRate
);

hydrateRoot(document, <StartClient />);

scheduleBrowserClientSentryInit({
  dsn: sentryDsn,
  init: () => {
    void import('./lib/observability/client-sentry').then(({ initWebClientSentry }) =>
      initWebClientSentry({
        dsn: sentryDsn,
        mode,
        tracesSampleRate,
        replaysSessionSampleRate,
        replaysOnErrorSampleRate,
      })
    );
  },
});
