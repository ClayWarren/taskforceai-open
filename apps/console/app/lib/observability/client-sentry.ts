type SentryClient = {
  init: (options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    replaysSessionSampleRate: number;
    replaysOnErrorSampleRate: number;
    ignoreErrors: string[];
  }) => void;
};

type BrowserInitScheduler = {
  requestIdleCallback?: (callback: () => void) => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
};

type InitConsoleClientSentryOptions = {
  dsn: string | undefined;
  mode: string;
  sentry: SentryClient;
};

type ScheduleClientSentryOptions = {
  dsn: string | undefined;
  init: () => void;
  target?: BrowserInitScheduler;
  isBrowser?: boolean;
};

const ignoredBrowserErrors = ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'];

export const initConsoleClientSentry = ({
  dsn,
  mode,
  sentry,
}: InitConsoleClientSentryOptions): boolean => {
  if (!dsn) {
    return false;
  }

  sentry.init({
    dsn,
    environment: mode,
    tracesSampleRate: mode === 'production' ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: mode === 'production' ? 1.0 : 0,
    ignoreErrors: ignoredBrowserErrors,
  });

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
