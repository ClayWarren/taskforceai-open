import type { LoggerPort } from '@taskforceai/client-core/ports/logger';

export type TestLogEntry = {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: unknown;
};

export const createBufferingLogger = () => {
  const entries: TestLogEntry[] = [];
  const record = (level: TestLogEntry['level'], message: string, metadata?: unknown): void => {
    entries.push({ level, message, ...(metadata === undefined ? {} : { metadata }) });
  };
  const logger: LoggerPort = {
    debug: (message, metadata) => record('debug', message, metadata),
    info: (message, metadata) => record('info', message, metadata),
    warn: (message, metadata) => record('warn', message, metadata),
    error: (message, metadata) => record('error', message, metadata),
  };

  return {
    logger,
    clearBuffer: (): void => {
      entries.length = 0;
    },
    getBuffer: (): TestLogEntry[] => [...entries],
  };
};
