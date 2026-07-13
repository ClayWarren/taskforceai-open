export type BrowserSentryClient = {
  init: (options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    replaysSessionSampleRate: number;
    replaysOnErrorSampleRate: number;
    ignoreErrors: string[];
  }) => void;
};

export type BrowserInitScheduler = {
  requestIdleCallback?: (callback: () => void) => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
};

export type InitBasicBrowserClientSentryOptions = {
  dsn: string | undefined;
  mode: string;
  sentry: BrowserSentryClient;
  productionTracesSampleRate?: number;
  productionReplaysOnErrorSampleRate?: number;
};

export type ScheduleBrowserClientSentryOptions = {
  dsn: string | undefined;
  init: () => void;
  target?: BrowserInitScheduler;
  isBrowser?: boolean;
};

export const ignoredBrowserErrors = [
  'AbortError',
  'Load failed',
  'ResizeObserver loop limit exceeded',
];

export const initBasicBrowserClientSentry = ({
  dsn,
  mode,
  sentry,
  productionTracesSampleRate = 0.1,
  productionReplaysOnErrorSampleRate = 1,
}: InitBasicBrowserClientSentryOptions): boolean => {
  if (!dsn) {
    return false;
  }

  const isProduction = mode === 'production';
  sentry.init({
    dsn,
    environment: mode,
    tracesSampleRate: isProduction ? productionTracesSampleRate : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: isProduction ? productionReplaysOnErrorSampleRate : 0,
    ignoreErrors: [...ignoredBrowserErrors],
  });

  return true;
};

export const scheduleBrowserClientSentryInit = ({
  dsn,
  init,
  target = globalThis as BrowserInitScheduler,
  isBrowser = typeof window !== 'undefined',
}: ScheduleBrowserClientSentryOptions): boolean => {
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
