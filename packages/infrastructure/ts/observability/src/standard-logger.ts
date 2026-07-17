import { resolveConsoleLevels } from './console-levels';
import { createAppLogger } from './createAppLogger';
import type { SentryLike } from './sentry-transport';
import { createTauriTransport } from './tauri-transport';

export interface StandardLoggerOptions {
  app: string;
  sentry?: SentryLike;
  isDesktop?: boolean;
  environment?: string;
  isTest?: boolean;
  enableConsole?: boolean;
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
    enableConsole,
  } = options;

  const isProd = environment === 'production';
  const isServer = typeof window === 'undefined';
  const runtime = isServer ? 'server' : isDesktop ? 'desktop' : 'browser';

  const consoleLevels = resolveConsoleLevels({
    environment,
    runtime,
    productionServerLevels: ['info', 'warn', 'error'],
  });

  return createAppLogger({
    app,
    environment,
    runtime,
    isTest,
    enableConsole: enableConsole ?? !isTest,
    consoleLevels,
    bridgeConsole: !isServer && runtime === 'desktop',
    preserveNativeConsole: !isProd,
    ...(runtime === 'desktop' &&
      !isTest && {
        transports: [
          createTauriTransport({
            levels: ['debug', 'info', 'warn', 'error'],
            onError: (error: unknown) => {
              if (sentry) {
                sentry.captureException(error);
              }
            },
          }),
        ],
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
