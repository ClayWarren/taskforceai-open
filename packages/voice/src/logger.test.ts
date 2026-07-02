import { describe, expect, it } from 'bun:test';

import { getVoiceLogger } from './logger';

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
});
