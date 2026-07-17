import { describe, expect, it, vi } from 'bun:test';

import { initStatusClientSentry, scheduleClientSentryInit } from './client-sentry';

describe('status client Sentry bootstrap', () => {
  it('uses shared browser Sentry defaults', () => {
    const sentry = { init: vi.fn() };

    expect(initStatusClientSentry({ dsn: 'dsn', mode: 'production', sentry })).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'dsn',
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
    });
  });

  it('keeps the app scheduler wrapper', () => {
    const init = vi.fn();
    const setTimeout = vi.fn();

    expect(
      scheduleClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: true,
        target: { setTimeout },
      })
    ).toBe(true);
    expect(setTimeout).toHaveBeenCalledWith(init, 0);
  });
});
