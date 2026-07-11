export interface LoggerInterface {
  debug: (m: string, x?: unknown) => void;
  info: (m: string, x?: unknown) => void;
  warn: (m: string, x?: unknown) => void;
  error: (m: string, x?: unknown) => void;
}

const noop = () => {};

let _logger: LoggerInterface = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export const configureLogger = (l: LoggerInterface): void => {
  _logger = l;
};

export const logger: LoggerInterface = {
  debug: (m, x) => _logger.debug(m, x),
  info: (m, x) => _logger.info(m, x),
  warn: (m, x) => _logger.warn(m, x),
  error: (m, x) => _logger.error(m, x),
};
