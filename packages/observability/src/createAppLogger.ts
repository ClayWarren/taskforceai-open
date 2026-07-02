import {
  type ConsoleBridgeHandle,
  type LogLevel,
  Logger,
  type SentryLike,
  createConsoleTransport,
  createSentryTransport,
} from '@taskforceai/shared/logger';

import { setupConsoleBridge } from './console-bridge';
import { createTauriTransport } from './tauri-transport';

// Note: @taskforceai/config is now Go-only, accessing process.env directly
const readEnv = () => ({
  NODE_ENV: (typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined) ?? 'development',
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
  tauri?: {
    enabled: boolean;
    levels?: LogLevel[];
    onError?: (error: unknown) => void;
  };
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

const DEFAULT_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
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

const resolveConsoleLevels = ({
  environment,
  runtime,
  explicitLevels,
}: {
  environment: string;
  runtime?: string | undefined;
  explicitLevels?: LogLevel[] | undefined;
}): LogLevel[] => {
  if (explicitLevels) return explicitLevels;
  if (environment !== 'production') return DEFAULT_LEVELS;
  if (runtime === 'desktop') return ['error'];
  return ['warn', 'error'];
};

const parseLogLevel = (value: string | undefined): LogLevel | undefined => {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return undefined;
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
    tauri,
    sentry,
    tags,
  } = options;

  const environment = options.environment ?? env.NODE_ENV ?? 'development';
  const defaultEnableConsole = environment !== 'test';
  const resolvedEnableConsole = enableConsole ?? defaultEnableConsole;
  const envLevel = parseLogLevel(env.LOG_LEVEL);
  const level =
    options.level ??
    envLevel ??
    (environment === 'test' ? 'error' : environment === 'production' ? 'info' : 'debug');

  // Silence console transport by default in test to speed runs; allow explicit opt-in via enableConsole
  const shouldEnableConsole = resolvedEnableConsole;

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

  let consoleBridge: ConsoleBridgeHandle | undefined;
  let consoleForTransport: ConsoleLike | undefined = normalizeConsole(consoleRef);

  if (!isTest && shouldEnableConsole) {
    const consoleLevels = resolveConsoleLevels({
      environment,
      runtime,
      explicitLevels: options.consoleLevels,
    });

    const bridgeResult = setupConsoleBridge({
      logger,
      bridgeConsole,
      preserveNativeConsole,
      environment,
      ...(runtime ? { runtime } : {}),
      consoleLevels,
    });

    if (bridgeResult.consoleBridge) {
      consoleBridge = bridgeResult.consoleBridge;
    }
    if (bridgeResult.consoleForTransport) {
      consoleForTransport = bridgeResult.consoleForTransport;
    }

    logger.addTransport(
      createConsoleTransport({
        ...(consoleForTransport ? { console: consoleForTransport } : {}),
        levels: consoleLevels,
      })
    );
  }

  if (!isTest && tauri?.enabled) {
    logger.addTransport(
      createTauriTransport({
        levels: tauri.levels ?? DEFAULT_LEVELS,
        ...(tauri.onError ? { onError: tauri.onError } : {}),
      })
    );
  }

  if (!isTest && sentry?.client) {
    logger.addTransport(
      createSentryTransport({
        sentry: sentry.client,
        levels: sentry.levels ?? ['warn', 'error'],
        includeMetadata: sentry.includeMetadata ?? true,
      })
    );
  }

  if (tags?.length) {
    logger.mergeContext({ tags: tags.join(',') });
  }

  return consoleBridge ? { logger, consoleBridge } : { logger };
};
