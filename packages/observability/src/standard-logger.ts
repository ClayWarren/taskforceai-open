import type { LogLevel, SentryLike } from '@taskforceai/shared/logger';
import { createAppLogger } from './createAppLogger';

export interface StandardLoggerOptions {
  app: string;
  sentry?: SentryLike;
  isDesktop?: boolean;
  environment?: string;
  isTest?: boolean;
}

export const createStandardAppLogger = (options: StandardLoggerOptions) => {
  const {
    app,
    sentry,
    isDesktop = false,
    environment = (typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined) ??
      'development',
    isTest = (typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined) === 'test' ||
      (typeof process !== 'undefined' ? !!process.env?.['BUN_TEST'] : false),
  } = options;

  const isProd = environment === 'production';
  const isServer = typeof window === 'undefined';
  const runtime = isServer ? 'server' : isDesktop ? 'desktop' : 'browser';

  const serverConsoleLevels: LogLevel[] = isProd
    ? ['info', 'warn', 'error']
    : ['debug', 'info', 'warn', 'error'];

  const consoleLevels: LogLevel[] = isServer
    ? serverConsoleLevels
    : isProd && runtime === 'desktop'
      ? ['error']
      : isProd
        ? ['warn', 'error']
        : ['debug', 'info', 'warn', 'error'];

  return createAppLogger({
    app,
    environment,
    runtime,
    isTest,
    enableConsole: isServer ? !isTest : true,
    consoleLevels,
    bridgeConsole: !isServer && runtime === 'desktop',
    preserveNativeConsole: !isProd,
    ...(runtime === 'desktop' && {
      tauri: {
        enabled: true,
        levels: ['debug', 'info', 'warn', 'error'],
        onError: (error: unknown) => {
          if (!isTest && sentry) {
            sentry.captureException(error);
          }
        },
      },
    }),
    ...(!isTest &&
      sentry && {
        sentry: {
          client: sentry,
          levels: ['error'],
        },
      }),
  });
};
