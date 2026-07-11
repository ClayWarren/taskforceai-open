import { describe, expect, it, vi } from 'bun:test';

import { configureSyncLogger, getSyncLogger } from './logger';

describe('sync logger port', () => {
  it('keeps a stable port and delegates to app configuration', () => {
    const logger = getSyncLogger();
    const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    configureSyncLogger(target);

    logger.info('hello', { scope: 'sync' });

    expect(getSyncLogger()).toBe(logger);
    expect(target.info).toHaveBeenCalledWith('hello', { scope: 'sync' });
  });
});
