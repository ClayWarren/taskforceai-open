import { afterEach, describe, expect, it, vi } from 'bun:test';

import { createStandardAppLogger } from './standard-logger';

const originalWindow = globalThis.window;

const mockSentry = () => ({
  withScope: vi.fn(
    (
      callback: (scope: {
        setLevel: (level: string) => void;
        setContext: (name: string, context: Record<string, unknown> | null) => void;
        setTag: (key: string, value: string) => void;
        setExtra: (key: string, extra: unknown) => void;
      }) => void
    ) =>
      callback({
        setLevel: vi.fn(),
        setContext: vi.fn(),
        setTag: vi.fn(),
        setExtra: vi.fn(),
      })
  ),
  captureException: vi.fn().mockReturnValue('event-id-exception'),
  captureMessage: vi.fn().mockReturnValue('event-id-message'),
});

const installConsoleSpies = () => ({
  debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
});

const setWindow = (value: unknown) => {
  Object.defineProperty(globalThis, 'window', {
    value,
    configurable: true,
    writable: true,
  });
};

const flushAsyncTransports = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('createStandardAppLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setWindow(originalWindow);
  });

  it('uses server production console policy', () => {
    setWindow(undefined);
    const consoleSpies = installConsoleSpies();

    const { logger } = createStandardAppLogger({
      app: 'server-app',
      environment: 'production',
      isTest: false,
    });

    logger.debug('debug-hidden');
    logger.info('info-visible');

    expect(consoleSpies.debug).not.toHaveBeenCalled();
    expect(consoleSpies.info).toHaveBeenCalledTimes(1);
    expect(String(consoleSpies.info.mock.calls[0]?.[0])).toContain('runtime=server');
  });

  it('uses browser production console policy', () => {
    setWindow({});
    const consoleSpies = installConsoleSpies();

    const { logger, consoleBridge } = createStandardAppLogger({
      app: 'browser-app',
      environment: 'production',
      isTest: false,
    });

    logger.info('info-hidden');
    logger.warn('warn-visible');

    expect(consoleBridge).toBeUndefined();
    expect(consoleSpies.info).not.toHaveBeenCalled();
    expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
    expect(String(consoleSpies.warn.mock.calls[0]?.[0])).toContain('runtime=browser');
  });

  it('uses desktop production bridge and transport policy', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    setWindow({ __TAURI__: { invoke } });
    const consoleSpies = installConsoleSpies();
    const sentry = mockSentry();

    const { logger, consoleBridge } = createStandardAppLogger({
      app: 'desktop-app',
      environment: 'production',
      isDesktop: true,
      isTest: false,
      sentry,
    });

    logger.warn('warn-tauri-only');
    logger.error('error-everywhere');
    await flushAsyncTransports();

    expect(consoleBridge).toBeDefined();
    expect(consoleSpies.warn).not.toHaveBeenCalled();
    expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith(
      'log_event',
      expect.objectContaining({
        entry: expect.objectContaining({
          context: expect.objectContaining({ runtime: 'desktop' }),
          message: 'error-everywhere',
        }),
      })
    );
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('error-everywhere', {
      level: 'error',
    });

    consoleBridge?.restore();
  });

  it('does not attach transports in test mode by default', () => {
    setWindow(undefined);
    const consoleSpies = installConsoleSpies();
    const sentry = mockSentry();

    const { logger } = createStandardAppLogger({
      app: 'test-app',
      environment: 'test',
      sentry,
    });

    logger.error('hidden-in-test');

    expect(consoleSpies.error).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports desktop Tauri transport errors to Sentry outside tests', async () => {
    const invokeError = new Error('native logging failed');
    setWindow({ __TAURI__: { invoke: vi.fn().mockRejectedValue(invokeError) } });
    installConsoleSpies();
    const sentry = mockSentry();

    const { logger, consoleBridge } = createStandardAppLogger({
      app: 'desktop-app',
      environment: 'development',
      isDesktop: true,
      isTest: false,
      sentry,
    });

    logger.info('tauri-fails');
    await flushAsyncTransports();

    expect(sentry.captureException).toHaveBeenCalledWith(invokeError);
    consoleBridge?.restore();
  });
});
