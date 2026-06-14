import { env } from '@taskforceai/shared/config/env';
import { Logger, createConsoleTransport } from '@taskforceai/shared/logger';

let logger: Logger | null = null;

const isBrowserProduction = (): boolean => {
  try {
    // @ts-ignore Vite SSR requires direct import.meta.env property access.
    const prod = import.meta.env.PROD as unknown;
    // @ts-ignore Vite SSR requires direct import.meta.env property access.
    const mode = import.meta.env.MODE as unknown;
    return prod === true || prod === 'true' || mode === 'production';
  } catch {
    return false;
  }
};

const resolveLevel = (): 'debug' | 'info' => {
  const level = env.NODE_ENV === 'production' || isBrowserProduction() ? 'info' : 'debug';
  return level;
};

export const getPersistenceLogger = (): Logger => {
  if (!logger) {
    logger = new Logger({
      level: resolveLevel(),
      context: { component: 'persistence' },
    });

    logger.addTransport(
      createConsoleTransport({
        levels: ['debug', 'info', 'warn', 'error'],
        includeTimestamp: true,
      })
    );
  }

  return logger;
};
