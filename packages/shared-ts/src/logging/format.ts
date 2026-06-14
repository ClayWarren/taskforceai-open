import { normalizeMeta } from './meta';
import { sanitizeValue } from './sanitize';
import type { LogLevel } from './structured-logger';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: unknown;
  environment?: string;
  nodeVersion?: string;
  correlationId?: string;
}

export const formatLogEntry = (params: {
  level: LogLevel;
  message: string;
  meta: unknown;
  environment: string;
  nodeVersion: string;
  correlationId: string | undefined;
  baseMeta: Record<string, unknown>;
  getLogMetadata: () => Record<string, unknown>;
}): string => {
  const sanitizedMessage = String(sanitizeValue(params.message));

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: params.level,
    message: sanitizedMessage,
    environment: params.environment,
    nodeVersion: params.nodeVersion,
  };

  if (params.correlationId) {
    entry.correlationId = params.correlationId;
  }

  const normalized = normalizeMeta(params.baseMeta, params.getLogMetadata, params.meta);
  if (normalized) {
    entry.meta = sanitizeValue(normalized);
  }

  return JSON.stringify(entry);
};
