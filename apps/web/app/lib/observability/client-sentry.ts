import type { SentryLike } from '@taskforceai/shared/logger';

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

type BrowserInitScheduler = {
  requestIdleCallback?: (callback: () => void) => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
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

type ScheduleClientSentryOptions = {
  dsn: string | undefined;
  init: () => void;
  target?: BrowserInitScheduler;
  isBrowser?: boolean;
};

const ignoredBrowserErrors = ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'];

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
    ignoreErrors: ignoredBrowserErrors,
  });
  loggerModule.installSentryLoggerTransport(Sentry);
  metricsModule.installSentryMetricsTransport(Sentry);

  return true;
};

export const scheduleClientSentryInit = ({
  dsn,
  init,
  target = globalThis as BrowserInitScheduler,
  isBrowser = typeof window !== 'undefined',
}: ScheduleClientSentryOptions): boolean => {
  if (!dsn || !isBrowser) {
    return false;
  }

  if (typeof target.requestIdleCallback === 'function') {
    target.requestIdleCallback(init);
    return true;
  }

  target.setTimeout(init, 0);
  return true;
};
