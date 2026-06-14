import { env } from '@taskforceai/shared/config/env';
import { Logger, createConsoleTransport } from '@taskforceai/shared/logger';

let logger: Logger | null = null;

const resolveLevel = (): 'debug' | 'info' => {
  const level = env.NODE_ENV === 'production' ? 'info' : 'debug';
  return level;
};

export const getVoiceLogger = (): Logger => {
  if (!logger) {
    logger = new Logger({
      level: resolveLevel(),
      context: { component: 'voice' },
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
