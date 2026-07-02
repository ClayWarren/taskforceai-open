import {
  CONSOLE_BRIDGE_METADATA_KEY,
  type LogEntry,
  type LogLevel,
  type LogTransport,
} from '../types';

type ConsoleLike = Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;

export interface ConsoleTransportOptions {
  console?: ConsoleLike;
  levels?: LogLevel[];
  includeTimestamp?: boolean;
}

const levelToMethod: Record<LogLevel, keyof ConsoleLike> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

export const createConsoleTransport = (options: ConsoleTransportOptions = {}): LogTransport => {
  const consoleRef = options.console ?? (typeof console !== 'undefined' ? console : undefined);
  const enabledLevels = new Set(options.levels ?? ['debug', 'info', 'warn', 'error']);
  const includeTimestamp = options.includeTimestamp ?? false;

  return {
    name: 'console',
    log(entry: LogEntry) {
      if (!consoleRef || !enabledLevels.has(entry.level)) {
        return;
      }
      if (shouldSkipConsoleEcho(entry.metadata)) {
        return;
      }

      const method = levelToMethod[entry.level];
      const prefix = includeTimestamp
        ? `[${entry.timestamp}] [${entry.level.toUpperCase()}]`
        : `[${entry.level.toUpperCase()}]`;
      const formattedContext = entry.context ? formatContext(entry.context) : '';
      const contextInfo = formattedContext ? ` ${formattedContext}` : '';
      const message = `${prefix}${contextInfo} ${entry.message}`;

      const args: unknown[] = [];
      if (entry.metadata) {
        args.push(stripInternalMetadata(entry.metadata));
      }

      try {
        consoleRef[method](message, ...args);
      } catch {
        // Ignore console failures
      }
    },
  };
};

const shouldSkipConsoleEcho = (metadata: unknown): boolean =>
  typeof metadata === 'object' &&
  metadata !== null &&
  !Array.isArray(metadata) &&
  (metadata as Record<string, unknown>)[CONSOLE_BRIDGE_METADATA_KEY] === true;

const stripInternalMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  if (!(CONSOLE_BRIDGE_METADATA_KEY in metadata)) {
    return metadata;
  }
  const clone = { ...metadata };
  delete clone[CONSOLE_BRIDGE_METADATA_KEY];
  return clone;
};

const formatContext = (context: Record<string, unknown>): string => {
  const keys = Object.keys(context);
  if (!keys.length) {
    return '';
  }
  return keys.map((key) => `${key}=${String(context[key])}`).join(' ');
};
