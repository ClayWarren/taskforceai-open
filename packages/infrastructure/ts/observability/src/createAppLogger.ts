import {
  type ConsoleBridgeHandle,
  type LogLevel,
  type LogTransport,
  Logger,
  createConsoleTransport,
} from '@taskforceai/observability/logger';

import { resolveConsoleLevels } from './console-levels';
import { setupConsoleBridge } from './console-bridge';
import { createSentryTransport, type SentryLike } from './sentry-transport';

// Note: @taskforceai/config is now Go-only, accessing process.env directly
const readEnv = () => ({
  NODE_ENV: typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined,
  LOG_LEVEL: typeof process !== 'undefined' ? process.env?.['LOG_LEVEL'] : undefined,
});

export interface AppLoggerOptions {
  app: string;
  environment?: string;
  runtime?: string;
  level?: LogLevel;
  context?: Record<string, unknown>;
  maxBufferSize?: number;
  isTest?: boolean;
  enableConsole?: boolean;
  bridgeConsole?: boolean;
  preserveNativeConsole?: boolean;
  console?: Console;
  consoleLevels?: LogLevel[];
  transports?: LogTransport[];
  sentry?: {
    client: SentryLike;
    levels?: LogLevel[];
    includeMetadata?: boolean;
  };
  tags?: string[];
}

export interface AppLoggerResult {
  logger: Logger;
  consoleBridge?: ConsoleBridgeHandle;
}

export type ConsoleLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

const normalizeConsole = (value: Console | undefined): ConsoleLike | undefined => {
  if (!value) {
    return undefined;
  }
  return {
    debug: value.debug?.bind(value) ?? (() => undefined),
    info: value.info?.bind(value) ?? (() => undefined),
    warn: value.warn?.bind(value) ?? (() => undefined),
    error: value.error?.bind(value) ?? (() => undefined),
  };
};

const parseLogLevel = (value: string | undefined): LogLevel | undefined => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return undefined;
};

const addConsoleLoggerTransport = (options: {
  logger: Logger;
  environment: string;
  runtime?: string;
  bridgeConsole: boolean;
  preserveNativeConsole: boolean;
  consoleRef: Console;
  consoleLevels?: LogLevel[];
}): ConsoleBridgeHandle | undefined => {
  const consoleLevels = resolveConsoleLevels({
    environment: options.environment,
    runtime: options.runtime,
    explicitLevels: options.consoleLevels,
  });
  const bridgeResult = setupConsoleBridge({
    logger: options.logger,
    bridgeConsole: options.bridgeConsole,
    preserveNativeConsole: options.preserveNativeConsole,
    environment: options.environment,
    ...(options.runtime ? { runtime: options.runtime } : {}),
    consoleLevels,
  });
  const consoleForTransport =
    bridgeResult.consoleForTransport ?? normalizeConsole(options.consoleRef);
  options.logger.addTransport(
    createConsoleTransport({
      ...(consoleForTransport ? { console: consoleForTransport } : {}),
      levels: consoleLevels,
    })
  );
  return bridgeResult.consoleBridge;
};

const addOptionalLoggerTransports = (
  logger: Logger,
  options: Pick<AppLoggerOptions, 'isTest' | 'transports' | 'sentry' | 'tags'>
): void => {
  options.transports?.forEach((transport) => logger.addTransport(transport));
  if (!options.isTest && options.sentry?.client) {
    logger.addTransport(
      createSentryTransport({
        sentry: options.sentry.client,
        levels: options.sentry.levels ?? ['warn', 'error'],
        includeMetadata: options.sentry.includeMetadata ?? true,
      })
    );
  }
  if (options.tags?.length) logger.mergeContext({ tags: options.tags.join(',') });
};

export const createAppLogger = (options: AppLoggerOptions): AppLoggerResult => {
  const env = readEnv();

  const {
    app,
    runtime,
    context,
    maxBufferSize = 200,
    isTest = false,
    enableConsole,
    bridgeConsole = false,
    preserveNativeConsole = true,
    console: consoleRef = console,
    transports,
    sentry,
    tags,
  } = options;

  const environment = options.environment ?? env.NODE_ENV ?? 'development';
  const defaultEnableConsole = !isTest && environment !== 'test';
  const resolvedEnableConsole = enableConsole ?? defaultEnableConsole;
  const envLevel = parseLogLevel(env.LOG_LEVEL);
  const level =
    options.level ??
    envLevel ??
    (environment === 'test' ? 'error' : environment === 'production' ? 'info' : 'debug');

  const logger = new Logger({
    level,
    maxBufferSize,
    context: {
      app,
      environment,
      ...(runtime ? { runtime } : {}),
      ...context,
    },
  });

  const consoleBridge = resolvedEnableConsole
    ? addConsoleLoggerTransport({
        logger,
        bridgeConsole,
        preserveNativeConsole,
        environment,
        consoleRef,
        runtime,
        consoleLevels: options.consoleLevels,
      })
    : undefined;

  addOptionalLoggerTransports(logger, { isTest, transports, sentry, tags });

  return consoleBridge ? { logger, consoleBridge } : { logger };
};
