import { extractError, normalizeMeta } from '@taskforceai/shared/logging/meta';
import { sanitizeValue } from '@taskforceai/shared/logging/sanitize';
import type {
  ErrorReporter,
  ErrorReporterPayload,
} from '@taskforceai/shared/logging/structured-logger';

interface SentryScope {
  setLevel: (level: 'debug' | 'info' | 'warning' | 'error' | 'fatal') => void;
  setContext: (name: string, context: Record<string, unknown> | null) => void;
  setExtra: (key: string, extra: unknown) => void;
  setFingerprint: (fingerprint: string[]) => void;
}

interface SentryClient<THint = unknown> {
  withScope: (callback: (scope: SentryScope) => void) => void;
  captureException: (error: unknown, hint?: THint) => string;
  captureMessage: (message: string, hint?: THint) => string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const flattenError = (error: Error): Record<string, unknown> => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
  ...Object.fromEntries(
    Object.getOwnPropertyNames(error)
      .filter((key) => !['name', 'message', 'stack'].includes(key))
      .map((key) => [key, (error as unknown as Record<string, unknown>)[key]])
  ),
});

const normalizeSentryExtra = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value instanceof Error) {
    return sanitizeValue(flattenError(value));
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    try {
      return value.map((entry) => normalizeSentryExtra(entry, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    try {
      return sanitizeValue(
        Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, normalizeSentryExtra(entry, seen)])
        )
      );
    } finally {
      seen.delete(value);
    }
  }
  return sanitizeValue(value);
};

export const createSentryErrorReporter = <THint>(sentry: SentryClient<THint>): ErrorReporter => {
  return (payload: ErrorReporterPayload) => {
    const error = extractError(payload.meta);
    const contextMeta = normalizeMeta(payload.baseMeta, payload.getLogMetadata, payload.meta);

    sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setContext('logger', {
        message: payload.message,
        environment: payload.environment,
        correlationId: payload.correlationId,
      });

      if (payload.meta && payload.meta !== error) {
        scope.setExtra('meta', normalizeSentryExtra(payload.meta));
      }

      if (contextMeta) {
        scope.setExtra('contextMeta', normalizeSentryExtra(contextMeta));
      }

      if (error) {
        scope.setFingerprint([error.name, payload.message]);
        sentry.captureException(error);
        return;
      }

      sentry.captureMessage(payload.message);
    });
  };
};
