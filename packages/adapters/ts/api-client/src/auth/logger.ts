import type { LoggerPort } from '@taskforceai/client-core/ports/logger';

const noop = (): void => {};
let target: LoggerPort = { debug: noop, info: noop, warn: noop, error: noop };

const logger: LoggerPort = {
  debug: (message, metadata) => target.debug(message, metadata),
  info: (message, metadata) => target.info(message, metadata),
  warn: (message, metadata) => target.warn(message, metadata),
  error: (message, metadata) => target.error(message, metadata),
};

export const configureAuthLogger = (configured: LoggerPort): void => {
  target = configured;
};

export const getAuthLogger = (): LoggerPort => logger;
