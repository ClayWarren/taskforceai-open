import { StartClient } from '@tanstack/react-start/client';
import * as Sentry from '@sentry/react';
import { hydrateRoot } from 'react-dom/client';

const sentryDsn = import.meta.env['VITE_SENTRY_DSN'];
const mode = import.meta.env['MODE'] ?? 'development';

hydrateRoot(document, <StartClient />);

const initSentry = (): void => {
  if (!sentryDsn) {
    return;
  }
  Sentry.init({
    dsn: sentryDsn,
    environment: mode,
    tracesSampleRate: mode === 'production' ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: mode === 'production' ? 1.0 : 0,
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
