import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AppLoggerResult } from '@taskforceai/observability';

const addTransport = mock();
const createStandardAppLogger = mock();
const createSentryTransport = mock();
const createTraceOperation = mock(() => mock());
const injectActiveTraceContext = mock();
const isDesktopRuntime = mock();

const logger = {
  addTransport,
} as unknown as AppLoggerResult['logger'];

mock.module('@taskforceai/observability', () => ({
  createStandardAppLogger,
  createSentryTransport,
  createTraceOperation,
  injectActiveTraceContext,
}));

mock.module('@taskforceai/browser-runtime/runtime', () => ({
  isDesktopRuntime,
}));

type LoggerModule = typeof import('./logger');

const originalMode = import.meta.env.MODE;

const importLoggerModule = async (mode: string): Promise<LoggerModule> => {
  import.meta.env.MODE = mode;
  return import(`./logger?mode=${mode}&ts=${Date.now()}-${Math.random()}`) as Promise<LoggerModule>;
};

describe('web logger', () => {
  beforeEach(() => {
    addTransport.mockReset();
    createStandardAppLogger.mockReset();
    createSentryTransport.mockReset();
    createTraceOperation.mockClear();
    injectActiveTraceContext.mockClear();
    isDesktopRuntime.mockReset();

    createStandardAppLogger.mockReturnValue({ logger });
    createSentryTransport.mockReturnValue({ name: 'sentry' });
    isDesktopRuntime.mockReturnValue(false);
  });

  afterEach(() => {
    import.meta.env.MODE = originalMode;
  });

  it('creates the standard app logger with web context', async () => {
    const module = await importLoggerModule('production');

    expect(module.logger).toBe(logger);
    expect(isDesktopRuntime).toHaveBeenCalledTimes(1);
    expect(createStandardAppLogger).toHaveBeenCalledWith({
      app: 'web',
      environment: 'production',
      isDesktop: false,
    });
  });

  it('does not install Sentry transport while tests are running', async () => {
    const module = await importLoggerModule('test');
    const sentry = {
      captureException: mock(),
      captureMessage: mock(),
      withScope: mock(),
    };

    module.installSentryLoggerTransport(sentry);

    expect(createSentryTransport).not.toHaveBeenCalled();
    expect(addTransport).not.toHaveBeenCalled();
  });

  it('installs the Sentry transport once outside test mode', async () => {
    const sentryTransport = { name: 'sentry' };
    createSentryTransport.mockReturnValue(sentryTransport);
    const module = await importLoggerModule('production');
    const sentry = {
      captureException: mock(),
      captureMessage: mock(),
      withScope: mock(),
    };

    module.installSentryLoggerTransport(sentry);
    module.installSentryLoggerTransport(sentry);

    expect(createSentryTransport).toHaveBeenCalledTimes(1);
    expect(createSentryTransport).toHaveBeenCalledWith({
      sentry,
      levels: ['error'],
    });
    expect(addTransport).toHaveBeenCalledTimes(1);
    expect(addTransport).toHaveBeenCalledWith(sentryTransport);
  });
});
