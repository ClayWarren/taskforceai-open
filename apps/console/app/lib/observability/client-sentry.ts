import {
  initBasicBrowserClientSentry,
  scheduleBrowserClientSentryInit,
  type BrowserSentryClient,
  type InitBasicBrowserClientSentryOptions,
  type ScheduleBrowserClientSentryOptions,
} from '@taskforceai/observability/browser-client-sentry';
import type { SentryLike } from '@taskforceai/observability';
import type { SentryMetricsClient } from '@taskforceai/observability/metrics';
import { installSentryLoggerTransport } from '../logger';
import { installSentryMetricsTransport } from './metrics';

type ConsoleSentryClient = BrowserSentryClient & SentryLike & SentryMetricsClient;

type InitConsoleClientSentryOptions = Omit<InitBasicBrowserClientSentryOptions, 'sentry'> & {
  loadSentry?: () => Promise<ConsoleSentryClient>;
  installLogger?: (sentry: ConsoleSentryClient) => void;
  installMetrics?: (sentry: ConsoleSentryClient) => void;
};

export const initConsoleClientSentry = async ({
  dsn,
  mode,
  productionTracesSampleRate,
  productionReplaysOnErrorSampleRate,
  loadSentry = () => import('@sentry/react') as unknown as Promise<ConsoleSentryClient>,
  installLogger = installSentryLoggerTransport,
  installMetrics = installSentryMetricsTransport,
}: InitConsoleClientSentryOptions): Promise<boolean> => {
  if (!dsn) {
    return false;
  }

  const sentry = await loadSentry();
  initBasicBrowserClientSentry({
    dsn,
    mode,
    sentry,
    ...(productionTracesSampleRate !== undefined && { productionTracesSampleRate }),
    ...(productionReplaysOnErrorSampleRate !== undefined && {
      productionReplaysOnErrorSampleRate,
    }),
  });
  installLogger(sentry);
  installMetrics(sentry);
  return true;
};

export const scheduleClientSentryInit = (options: ScheduleBrowserClientSentryOptions): boolean =>
  scheduleBrowserClientSentryInit(options);
