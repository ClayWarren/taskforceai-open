import type { ReactNode } from 'react';

import {
  initStatusClientSentry,
  scheduleClientSentryInit,
} from './lib/observability/client-sentry';

type HydrateRoot = (container: Document, initialChildren: ReactNode) => unknown;
type InitStatusClientSentry = typeof initStatusClientSentry;
type ScheduleClientSentryInit = typeof scheduleClientSentryInit;
type StatusSentryClient = Parameters<InitStatusClientSentry>[0]['sentry'];

type StatusClientBootstrapOptions = {
  documentTarget: Document;
  startClient: ReactNode;
  hydrateRoot: HydrateRoot;
  sentry: StatusSentryClient;
  dsn: string | undefined;
  mode: string;
  initStatusClientSentry?: InitStatusClientSentry;
  scheduleClientSentryInit?: ScheduleClientSentryInit;
};

export function bootstrapStatusClient({
  documentTarget,
  startClient,
  hydrateRoot,
  sentry,
  dsn,
  mode,
  initStatusClientSentry: initClientSentry = initStatusClientSentry,
  scheduleClientSentryInit: scheduleSentryInit = scheduleClientSentryInit,
}: StatusClientBootstrapOptions): void {
  hydrateRoot(documentTarget, startClient);

  const initSentry = (): boolean =>
    initClientSentry({
      dsn,
      mode,
      sentry,
    });

  scheduleSentryInit({
    dsn,
    init: initSentry,
  });
}
