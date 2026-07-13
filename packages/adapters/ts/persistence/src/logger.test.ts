import { describe, expect, it, vi } from 'bun:test';

import { configurePersistenceLogger, getPersistenceLogger } from './logger';

describe('persistence logger', () => {
  it('forwards every level to the configured logger port', () => {
    const configured = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    configurePersistenceLogger(configured);

    const logger = getPersistenceLogger();
    logger.debug('debug', { level: 1 });
    logger.info('info', { level: 2 });
    logger.warn('warn', { level: 3 });
    logger.error('error', { level: 4 });

    expect(configured.debug).toHaveBeenCalledWith('debug', { level: 1 });
    expect(configured.info).toHaveBeenCalledWith('info', { level: 2 });
    expect(configured.warn).toHaveBeenCalledWith('warn', { level: 3 });
    expect(configured.error).toHaveBeenCalledWith('error', { level: 4 });
  });
});
