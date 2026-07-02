import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { initConsoleClientSentry, scheduleClientSentryInit } from './client-sentry';

describe('console client Sentry bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips initialization when no DSN is configured', () => {
    const sentry = { init: vi.fn() };

    expect(initConsoleClientSentry({ dsn: undefined, mode: 'production', sentry })).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('uses production sampling when initializing Sentry', () => {
    const sentry = { init: vi.fn() };

    expect(initConsoleClientSentry({ dsn: 'dsn', mode: 'production', sentry })).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'dsn',
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
    });
  });

  it('disables sampling outside production', () => {
    const sentry = { init: vi.fn() };

    expect(initConsoleClientSentry({ dsn: 'dsn', mode: 'development', sentry })).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        tracesSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      })
    );
  });

  it('schedules initialization with idle callbacks, timeout fallback, and SSR guard', () => {
    const init = vi.fn();
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();

    expect(
      scheduleClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: true,
        target: { requestIdleCallback, setTimeout },
      })
    ).toBe(true);
    expect(requestIdleCallback).toHaveBeenCalledWith(init);
    expect(setTimeout).not.toHaveBeenCalled();

    expect(
      scheduleClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: true,
        target: { setTimeout },
      })
    ).toBe(true);
    expect(setTimeout).toHaveBeenCalledWith(init, 0);

    expect(
      scheduleClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: false,
        target: { setTimeout },
      })
    ).toBe(false);
    expect(
      scheduleClientSentryInit({
        dsn: undefined,
        init,
        isBrowser: true,
        target: { setTimeout },
      })
    ).toBe(false);
  });
});
