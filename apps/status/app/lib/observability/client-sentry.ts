import {
  initBasicBrowserClientSentry,
  scheduleBrowserClientSentryInit,
  type InitBasicBrowserClientSentryOptions,
  type ScheduleBrowserClientSentryOptions,
} from '@taskforceai/observability/browser-client-sentry';

export const initStatusClientSentry = (options: InitBasicBrowserClientSentryOptions): boolean =>
  initBasicBrowserClientSentry(options);

export const scheduleClientSentryInit = (options: ScheduleBrowserClientSentryOptions): boolean =>
  scheduleBrowserClientSentryInit(options);
