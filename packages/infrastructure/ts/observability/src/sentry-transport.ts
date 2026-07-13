import type {
  LogEntry,
  LogLevel,
  LogMetadata,
  LogTransport,
} from '@taskforceai/observability/logger';

interface SentryScopeLike {
  setLevel(level: 'debug' | 'info' | 'warning' | 'error' | 'fatal'): void;
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, extra: unknown): void;
}

export interface SentryLike {
  withScope(callback: (scope: SentryScopeLike) => void): void;
  captureException(error: unknown, hint?: unknown): string;
  captureMessage(message: string, hint?: unknown): string;
}

export interface SentryTransportOptions {
  sentry: SentryLike;
  levels?: LogLevel[];
  mapLevel?: (level: LogLevel) => SentryLevel;
  includeMetadata?: boolean;
}

type SentryLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

const defaultLevelMap: Record<LogLevel, SentryLevel> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asError = (value: unknown): Error | undefined => {
  if (value instanceof Error) {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const message = typeof value['message'] === 'string' ? value['message'] : undefined;
  const name = typeof value['name'] === 'string' ? value['name'] : undefined;
  const stack = typeof value['stack'] === 'string' ? value['stack'] : undefined;

  if (!message && !stack) {
    return undefined;
  }

  const error = new Error(message ?? 'Unknown error');
  if (name) {
    error.name = name;
  }
  if (stack) {
    error.stack = stack;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    (error as unknown as Record<string, unknown>)[key] = entry;
  }

  return error;
};

export const createSentryTransport = (options: SentryTransportOptions): LogTransport => {
  const { sentry, levels, includeMetadata = true } = options;
  const enabledLevels = new Set(levels ?? ['error']);
  const mapLevel = options.mapLevel ?? ((level: LogLevel) => defaultLevelMap[level]);

  return {
    name: 'sentry',
    log(entry: LogEntry) {
      if (!enabledLevels.has(entry.level)) {
        return;
      }

      const errorMetadata = extractError(entry.metadata);
      const sentryLevel = mapLevel(entry.level);

      sentry.withScope((scope) => {
        scope.setLevel(sentryLevel);
        if (entry.context) {
          scope.setContext('logger', entry.context);
        }
        if (entry.tags?.length) {
          entry.tags.forEach((tag) => scope.setTag(tag, 'true'));
        }
        if (includeMetadata && entry.metadata) {
          Object.entries(entry.metadata).forEach(([key, value]) => {
            scope.setExtra(key, value);
          });
        }

        if (errorMetadata) {
          sentry.captureException(errorMetadata, {
            level: sentryLevel,
            originalMessage: entry.message,
          });
        } else {
          sentry.captureMessage(entry.message, { level: sentryLevel });
        }
      });
    },
  };
};

const extractError = (metadata?: LogMetadata): unknown => {
  if (!metadata) {
    return undefined;
  }
  const fromError = asError(metadata['error']);
  if (fromError) {
    return fromError;
  }
  const fromException = asError(metadata['exception']);
  if (fromException) {
    return fromException;
  }
  return undefined;
};
