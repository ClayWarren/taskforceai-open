import { env } from '@taskforceai/shared/config/env';
import { Logger, createConsoleTransport } from '@taskforceai/shared/logger';

let logger: Logger | null = null;

const isBrowserProduction = (): boolean => {
  const metaEnv = (import.meta as unknown as { env?: { MODE?: string; PROD?: boolean } })?.env;
  return metaEnv?.PROD === true || metaEnv?.MODE === 'production';
};

const resolveLevel = (): 'debug' | 'info' =>
  env.NODE_ENV === 'production' || isBrowserProduction() ? 'info' : 'debug';

/**
 * Thin wrapper so shared sync utilities keep using structured logging without
 * directly touching console.*.
 */
export const getSyncLogger = (): Logger => {
  if (!logger) {
    logger = new Logger({
      level: resolveLevel(),
      context: { component: 'sync-client' },
    });
    logger.addTransport(
      createConsoleTransport({
        levels: ['debug', 'info', 'warn', 'error'],
      })
    );
  }
  return logger;
};
