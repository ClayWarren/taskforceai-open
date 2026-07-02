import { Logger, createConsoleTransport } from '@taskforceai/shared/logger';

let logger: Logger | null = null;

const getNodeEnv = (): string => {
  if (typeof process === 'undefined') {
    return 'development';
  }
  return process.env?.['NODE_ENV'] ?? 'development';
};

export const getAuthLogger = (): Logger => {
  if (!logger) {
    logger = new Logger({
      level: getNodeEnv() === 'production' ? 'info' : 'debug',
      context: { component: 'shared-auth' },
    });
    logger.addTransport(
      createConsoleTransport({
        levels: ['debug', 'info', 'warn', 'error'],
      })
    );
  }

  return logger;
};
