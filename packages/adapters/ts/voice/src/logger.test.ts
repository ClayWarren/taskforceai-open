import { describe, expect, it, vi } from 'bun:test';

import { configureVoiceLogger, getVoiceLogger } from './logger';

describe('voice/logger', () => {
  it('creates logger', () => {
    const logger = getVoiceLogger();

    expect(logger).toBeDefined();
  });

  it('logger has required methods', () => {
    const logger = getVoiceLogger();

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('logger can be called without throwing', () => {
    const logger = getVoiceLogger();

    // These should not throw
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });

  it('forwards every level to the configured logger port', () => {
    const configured = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    configureVoiceLogger(configured);

    const logger = getVoiceLogger();
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
