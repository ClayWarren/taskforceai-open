import { describe, expect, it, vi } from 'bun:test';

import { configureAuthLogger, getAuthLogger } from './logger';

describe('auth logger port', () => {
  it('delegates to the logger configured by the application', () => {
    const target = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    configureAuthLogger(target);

    getAuthLogger().warn('auth warning', { attempt: 1 });

    expect(target.warn).toHaveBeenCalledWith('auth warning', { attempt: 1 });
  });
});
