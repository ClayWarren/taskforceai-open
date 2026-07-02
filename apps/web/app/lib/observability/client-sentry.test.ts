import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { initWebClientSentry, scheduleClientSentryInit } from './client-sentry';

describe('web client Sentry bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips dynamic imports when no DSN is configured', async () => {
    const loadSentry = vi.fn();

    await expect(
      initWebClientSentry({
        dsn: undefined,
        mode: 'production',
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1,
        loadSentry,
      })
    ).resolves.toBe(false);

    expect(loadSentry).not.toHaveBeenCalled();
  });

  it('initializes Sentry and installs logger and metrics transports', async () => {
    const replayIntegration = vi.fn((options: unknown) => ({ options, name: 'replay' }));
    const Sentry = {
      init: vi.fn(),
      replayIntegration,
      addBreadcrumb: vi.fn(),
      captureException: vi.fn(() => 'event-id'),
      captureMessage: vi.fn(() => 'event-id'),
      withScope: vi.fn(),
    };
    const loggerModule = { installSentryLoggerTransport: vi.fn() };
    const metricsModule = { installSentryMetricsTransport: vi.fn() };

    await expect(
      initWebClientSentry({
        dsn: 'https://sentry.example/1',
        mode: 'production',
        tracesSampleRate: 0.25,
        replaysSessionSampleRate: 0.05,
        replaysOnErrorSampleRate: 1,
        loadSentry: () => Promise.resolve(Sentry),
        loadLogger: () => Promise.resolve(loggerModule),
        loadMetrics: () => Promise.resolve(metricsModule),
      })
    ).resolves.toBe(true);

    expect(replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      blockAllMedia: true,
    });
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://sentry.example/1',
      environment: 'production',
      tracesSampleRate: 0.25,
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 1,
      integrations: [{ name: 'replay', options: { maskAllText: true, blockAllMedia: true } }],
      ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
    });
    expect(loggerModule.installSentryLoggerTransport).toHaveBeenCalledWith(Sentry);
    expect(metricsModule.installSentryMetricsTransport).toHaveBeenCalledWith(Sentry);
  });

  it('schedules initialization during idle time when available', () => {
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
  });

  it('falls back to a zero-delay timeout and skips non-browser contexts', () => {
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
