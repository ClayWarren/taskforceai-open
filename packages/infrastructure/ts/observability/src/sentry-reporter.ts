import { extractError, normalizeMeta } from '@taskforceai/observability/logging/meta';
import { sanitizeValue } from '@taskforceai/observability/logging/sanitize';
import type {
  ErrorReporter,
  ErrorReporterPayload,
} from '@taskforceai/observability/logging/structured-logger';
import { createGraphTransformer } from './internal/graph-transform';
import { isApiKeyLikeSentryKey, isSensitiveSentryKey } from './sentry-sanitize';

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

const sanitizeSentryKeyValue = (key: string): string | undefined => {
  if (!isSensitiveSentryKey(key)) {
    return undefined;
  }
  if (isApiKeyLikeSentryKey(key)) {
    return '[REDACTED_API_KEY]';
  }
  return '[REDACTED]';
};

const flattenError = (error: Error): Record<string, unknown> => {
  const flattened: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key !== 'name' && key !== 'message' && key !== 'stack') {
      flattened[key] = (error as unknown as Record<string, unknown>)[key];
    }
  }

  return flattened;
};

const normalizeSentryExtra = (value: unknown): unknown =>
  createGraphTransformer({
    leaf: sanitizeValue,
    prepare: (entry) => (entry instanceof Error ? flattenError(entry) : entry),
    redact: sanitizeSentryKeyValue,
  })(value);

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
