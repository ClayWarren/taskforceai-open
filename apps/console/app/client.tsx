import { StartClient } from '@tanstack/react-start/client';
import { hydrateRoot } from 'react-dom/client';
import {
  initConsoleClientSentry,
  scheduleClientSentryInit,
} from './lib/observability/client-sentry';

const sentryDsn = import.meta.env['NEXT_PUBLIC_SENTRY_DSN'] ?? import.meta.env['VITE_SENTRY_DSN'];
const mode = import.meta.env['MODE'] ?? 'development';

hydrateRoot(document, <StartClient />);

const initSentry = (): void => {
  void initConsoleClientSentry({
    dsn: sentryDsn,
    mode,
  });
};

scheduleClientSentryInit({
  dsn: sentryDsn,
  init: initSentry,
});
