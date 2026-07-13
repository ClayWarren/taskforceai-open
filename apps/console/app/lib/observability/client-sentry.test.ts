import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { initConsoleClientSentry, scheduleClientSentryInit } from './client-sentry';

describe('console client Sentry bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips dynamic imports when no DSN is configured', async () => {
    const loadSentry = vi.fn();

    await expect(
      initConsoleClientSentry({
        dsn: undefined,
        mode: 'production',
        loadSentry,
      })
    ).resolves.toBe(false);

    expect(loadSentry).not.toHaveBeenCalled();
  });

  it('uses shared browser defaults and installs deferred transports', async () => {
    const sentry = {
      init: vi.fn(),
      addBreadcrumb: vi.fn(),
      captureException: vi.fn(() => 'event-id'),
      captureMessage: vi.fn(() => 'event-id'),
      withScope: vi.fn(),
    };
    const installLogger = vi.fn();
    const installMetrics = vi.fn();

    await expect(
      initConsoleClientSentry({
        dsn: 'dsn',
        mode: 'production',
        loadSentry: () => Promise.resolve(sentry),
        installLogger,
        installMetrics,
      })
    ).resolves.toBe(true);

    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'dsn',
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
    });
    expect(installLogger).toHaveBeenCalledWith(sentry);
    expect(installMetrics).toHaveBeenCalledWith(sentry);
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
