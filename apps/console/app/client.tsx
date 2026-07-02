import { StartClient } from '@tanstack/react-start/client';
import * as Sentry from '@sentry/react';
import { hydrateRoot } from 'react-dom/client';
import {
  initConsoleClientSentry,
  scheduleClientSentryInit,
} from './lib/observability/client-sentry';

const sentryDsn = import.meta.env['VITE_SENTRY_DSN'];
const mode = import.meta.env['MODE'] ?? 'development';

hydrateRoot(document, <StartClient />);

const initSentry = (): boolean =>
  initConsoleClientSentry({
    dsn: sentryDsn,
    mode,
    sentry: Sentry,
  });

scheduleClientSentryInit({
  dsn: sentryDsn,
  init: initSentry,
});
