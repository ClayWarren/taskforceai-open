import { beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  ignoredBrowserErrors,
  initBasicBrowserClientSentry,
  scheduleBrowserClientSentryInit,
} from './browser-client-sentry';

describe('browser client Sentry helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips initialization when no DSN is configured', () => {
    const sentry = { init: vi.fn() };

    expect(initBasicBrowserClientSentry({ dsn: undefined, mode: 'production', sentry })).toBe(
      false
    );
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('uses production sampling when initializing Sentry', () => {
    const sentry = { init: vi.fn() };

    expect(initBasicBrowserClientSentry({ dsn: 'dsn', mode: 'production', sentry })).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'dsn',
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      ignoreErrors: ignoredBrowserErrors,
    });
  });

  it('disables sampling outside production', () => {
    const sentry = { init: vi.fn() };

    expect(initBasicBrowserClientSentry({ dsn: 'dsn', mode: 'development', sentry })).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        tracesSampleRate: 0,
        replaysOnErrorSampleRate: 0,
      })
    );
  });

  it('allows production sampling overrides', () => {
    const sentry = { init: vi.fn() };

    expect(
      initBasicBrowserClientSentry({
        dsn: 'dsn',
        mode: 'production',
        sentry,
        productionTracesSampleRate: 0.25,
        productionReplaysOnErrorSampleRate: 0.5,
      })
    ).toBe(true);

    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        tracesSampleRate: 0.25,
        replaysOnErrorSampleRate: 0.5,
      })
    );
  });

  it('schedules initialization with idle callbacks, timeout fallback, and browser guards', () => {
    const init = vi.fn();
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();

    expect(
      scheduleBrowserClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: true,
        target: { requestIdleCallback, setTimeout },
      })
    ).toBe(true);
    expect(requestIdleCallback).toHaveBeenCalledWith(init);
    expect(setTimeout).not.toHaveBeenCalled();

    expect(
      scheduleBrowserClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: true,
        target: { setTimeout },
      })
    ).toBe(true);
    expect(setTimeout).toHaveBeenCalledWith(init, 0);

    expect(
      scheduleBrowserClientSentryInit({
        dsn: 'dsn',
        init,
        isBrowser: false,
        target: { setTimeout },
      })
    ).toBe(false);
    expect(
      scheduleBrowserClientSentryInit({
        dsn: undefined,
        init,
        isBrowser: true,
        target: { setTimeout },
      })
    ).toBe(false);
  });
});
