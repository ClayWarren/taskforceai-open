import { Logger } from './logger';
import {
  CONSOLE_BRIDGE_METADATA_KEY,
  type LogLevel,
  type LogMetadata,
  type StructuredConsoleBridgeOptions,
} from './types';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface ConsoleSnapshot extends Record<ConsoleMethod, (...args: unknown[]) => void> {}

export interface ConsoleBridgeHandle {
  restore(): void;
  console: ConsoleSnapshot;
}

const methodToLevel: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
};

export const bridgeConsoleToLogger = (
  logger: Logger,
  options: StructuredConsoleBridgeOptions = {}
): ConsoleBridgeHandle | undefined => {
  if (typeof console === 'undefined') {
    return undefined;
  }

  const preserveNative = options.preserveNative ?? true;
  const enabledLevels = new Set(options.levels ?? ['debug', 'info', 'warn', 'error']);
  const snapshot = captureConsole();

  (Object.keys(snapshot) as ConsoleMethod[]).forEach((method) => {
    const level = methodToLevel[method];
    console[method] = (...args: unknown[]) => {
      const formatter = options.formatMessage ?? defaultFormatMessage;

      if (enabledLevels.has(level)) {
        const { message, metadata } = formatter(args);
        logger.log(level, message, {
          ...(metadata ? metadata : {}),
          consoleArgs: args,
          consoleMethod: method,
          [CONSOLE_BRIDGE_METADATA_KEY]: true,
        });
      }

      if (preserveNative) {
        snapshot[method](...args);
      }
    };
  });

  return {
    restore: () => restoreConsole(snapshot),
    console: snapshot,
  };
};

const captureConsole = (): ConsoleSnapshot => {
  const fallback = () => {};
  return {
    log: typeof console.log === 'function' ? console.log.bind(console) : fallback,
    info: typeof console.info === 'function' ? console.info.bind(console) : fallback,
    warn: typeof console.warn === 'function' ? console.warn.bind(console) : fallback,
    error: typeof console.error === 'function' ? console.error.bind(console) : fallback,
    debug: typeof console.debug === 'function' ? console.debug.bind(console) : fallback,
  };
};

const restoreConsole = (snapshot: ConsoleSnapshot): void => {
  (Object.keys(snapshot) as ConsoleMethod[]).forEach((method) => {
    console[method] = snapshot[method];
  });
};

const defaultFormatMessage = (
  args: unknown[]
): {
  message: string;
  metadata?: LogMetadata;
} => {
  if (!args.length) {
    return { message: '[console]' };
  }

  const [first, ...rest] = args;
  const message = deriveMessage(first);

  if (!rest.length) {
    return { message };
  }

  return {
    message,
    metadata: { rest },
  };
};

const deriveMessage = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized;
    }
    return String(value);
  } catch {
    return String(value);
  }
};
