import { StartClient } from '@tanstack/react-start/client';
import * as Sentry from '@sentry/react';
import { hydrateRoot } from 'react-dom/client';
import { bootstrapStatusClient } from './client-bootstrap';

const sentryDsn = import.meta.env['NEXT_PUBLIC_SENTRY_DSN'] ?? import.meta.env['VITE_SENTRY_DSN'];
const mode = import.meta.env['MODE'] ?? 'development';

bootstrapStatusClient({
  documentTarget: document,
  startClient: <StartClient />,
  hydrateRoot,
  sentry: Sentry,
  dsn: sentryDsn,
  mode,
});
