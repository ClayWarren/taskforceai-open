import { describe, expect, it, vi } from 'bun:test';

import { configureLogger, logger } from './logger';

describe('logger', () => {
  it('delegates to the configured logger implementation', () => {
    const customLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    configureLogger(customLogger);

    logger.debug('debug message', { detail: 1 });
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message', new Error('boom'));

    expect(customLogger.debug).toHaveBeenCalledWith('debug message', { detail: 1 });
    expect(customLogger.info).toHaveBeenCalledWith('info message', undefined);
    expect(customLogger.warn).toHaveBeenCalledWith('warn message', undefined);
    expect(customLogger.error).toHaveBeenCalledWith('error message', expect.any(Error));
  });
});
