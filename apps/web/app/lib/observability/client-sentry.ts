import {
  ignoredBrowserErrors,
  scheduleBrowserClientSentryInit,
  type ScheduleBrowserClientSentryOptions,
} from '@taskforceai/observability/browser-client-sentry';
import type { SentryLike } from '@taskforceai/observability';

type SentryClient = {
  init: (options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    replaysSessionSampleRate: number;
    replaysOnErrorSampleRate: number;
    integrations: unknown[];
    ignoreErrors: string[];
  }) => void;
  replayIntegration: (options: { maskAllText: boolean; blockAllMedia: boolean }) => unknown;
  addBreadcrumb: (breadcrumb: {
    category: string;
    message: string;
    data?: Record<string, unknown>;
    level?: 'info';
  }) => void;
} & SentryLike;

type LoggerModule = {
  installSentryLoggerTransport: (sentry: SentryClient) => void;
};

type MetricsModule = {
  installSentryMetricsTransport: (sentry: SentryClient) => void;
};

type InitWebClientSentryOptions = {
  dsn: string | undefined;
  mode: string;
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  loadSentry?: () => Promise<SentryClient>;
  loadLogger?: () => Promise<LoggerModule>;
  loadMetrics?: () => Promise<MetricsModule>;
};

export const initWebClientSentry = async ({
  dsn,
  mode,
  tracesSampleRate,
  replaysSessionSampleRate,
  replaysOnErrorSampleRate,
  loadSentry = () => import('@sentry/react') as Promise<SentryClient>,
  loadLogger = () => import('../logger') as Promise<LoggerModule>,
  loadMetrics = () => import('./metrics') as Promise<MetricsModule>,
}: InitWebClientSentryOptions): Promise<boolean> => {
  if (!dsn) {
    return false;
  }

  const [Sentry, loggerModule] = await Promise.all([loadSentry(), loadLogger()]);
  const metricsModule = await loadMetrics();

  Sentry.init({
    dsn,
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
    ignoreErrors: [...ignoredBrowserErrors],
  });
  loggerModule.installSentryLoggerTransport(Sentry);
  metricsModule.installSentryMetricsTransport(Sentry);

  return true;
};

export const scheduleClientSentryInit = (options: ScheduleBrowserClientSentryOptions): boolean =>
  scheduleBrowserClientSentryInit(options);
