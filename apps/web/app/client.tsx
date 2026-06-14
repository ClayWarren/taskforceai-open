import { StartClient } from '@tanstack/react-start/client';
import * as Sentry from '@sentry/react';
import { hydrateRoot } from 'react-dom/client';
import { parseSampleRate } from '@taskforceai/shared/utils/env-parsing';

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

const initSentry = (): void => {
  if (!sentryDsn) {
    return;
  }
  Sentry.init({
    dsn: sentryDsn,
    environment: mode,
    tracesSampleRate,
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
  });
};

if (sentryDsn && typeof window !== 'undefined') {
  const requestIdleCallbackFn = (
    globalThis as { requestIdleCallback?: (callback: () => void) => number }
  ).requestIdleCallback;
  if (typeof requestIdleCallbackFn === 'function') {
    requestIdleCallbackFn(() => {
      initSentry();
    });
  } else {
    globalThis.setTimeout(() => {
      initSentry();
    }, 0);
  }
}
