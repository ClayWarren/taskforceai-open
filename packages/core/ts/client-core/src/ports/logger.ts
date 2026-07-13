export interface LoggerPort {
  debug(message: string, metadata?: unknown): void;
  info(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
}

const noop = (): void => {};
const noopLogger: LoggerPort = { debug: noop, info: noop, warn: noop, error: noop };

export const createDelegatingLogger = () => {
  let target = noopLogger;
  return {
    configure: (configured: LoggerPort): void => {
      target = configured;
    },
    logger: {
      debug: (message, metadata) => target.debug(message, metadata),
      info: (message, metadata) => target.info(message, metadata),
      warn: (message, metadata) => target.warn(message, metadata),
      error: (message, metadata) => target.error(message, metadata),
    } satisfies LoggerPort,
  };
};
