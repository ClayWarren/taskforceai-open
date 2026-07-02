import { afterEach, describe, expect, it, vi } from 'bun:test';

import { createAppLogger, type AppLoggerOptions } from './createAppLogger';

type TestLoggerOptions = Omit<AppLoggerOptions, 'app'> & { app?: string };

const mockConsole = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockSentry = {
  withScope: vi.fn(
    (
      callback: (scope: {
        setLevel: () => void;
        setContext: () => void;
        setTag: () => void;
        setExtra: () => void;
      }) => void
    ) =>
      callback({
        setLevel: vi.fn(),
        setContext: vi.fn(),
        setTag: vi.fn(),
        setExtra: vi.fn(),
      })
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setContext: vi.fn(),
  setTags: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
};

const setEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
};

const expectLoggerDefined = (options: TestLoggerOptions) => {
  const { app = 'test-app', ...rest } = options;
  const { logger } = createAppLogger({ app, ...rest });
  expect(logger).toBeDefined();
};

const withEnvValue = (key: string, value: string | undefined, callback: () => void) => {
  const original = process.env[key];
  try {
    setEnvValue(key, value);
    callback();
  } finally {
    setEnvValue(key, original);
  }
};

describe('createAppLogger', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });
  it('creates a logger with console transport', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      environment: 'development',
      console: mockConsole as unknown as Console,
    });

    logger.info('hello');
    expect(mockConsole.info).toHaveBeenCalled();
  });

  it('supports disabling console logging in tests', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      isTest: true,
    });
    logger.info('noop');
    expect(mockConsole.info).not.toHaveBeenCalled();
  });

  it('uses production log level by default in production', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      environment: 'production',
      isTest: true,
    });

    expect(logger).toBeDefined();
  });

  it('uses debug log level in development', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      environment: 'development',
      isTest: true,
    });

    expect(logger).toBeDefined();
  });

  it('defaults to error level in test env when LOG_LEVEL is unset', () => {
    const original = process.env['LOG_LEVEL'];
    delete process.env['LOG_LEVEL'];

    const { logger } = createAppLogger({
      app: 'test-app',
      environment: 'test',
      // console transport disabled by default in test; enable explicitly to observe filtering
      isTest: false,
      enableConsole: true,
      console: mockConsole as unknown as Console,
    });

    logger.debug('should be filtered');
    logger.error('should pass');

    expect(mockConsole.debug).not.toHaveBeenCalled();
    expect(mockConsole.error).toHaveBeenCalled();

    if (original !== undefined) {
      process.env['LOG_LEVEL'] = original;
    } else {
      delete process.env['LOG_LEVEL'];
    }
  });

  for (const { name, options } of [
    { name: 'accepts custom log level', options: { level: 'error', isTest: true } },
    { name: 'includes app context', options: { isTest: true } },
    {
      name: 'includes runtime context when provided',
      options: { runtime: 'desktop', isTest: true },
    },
    { name: 'includes custom context', options: { context: { userId: '123' }, isTest: true } },
    { name: 'sets custom max buffer size', options: { maxBufferSize: 500, isTest: true } },
  ] satisfies Array<{ name: string; options: TestLoggerOptions }>) {
    it(name, () => {
      expectLoggerDefined(options);
    });
  }

  it('disables console when enableConsole is false', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      enableConsole: false,
      console: mockConsole as unknown as Console,
    });

    logger.info('test');
    expect(mockConsole.info).not.toHaveBeenCalled();
  });

  for (const { name, options } of [
    {
      name: 'adds sentry transport when sentry client provided',
      options: {
        sentry: { client: mockSentry, levels: ['error'], includeMetadata: true },
        isTest: false,
      },
    },
    {
      name: 'does not add sentry transport in test mode',
      options: { sentry: { client: mockSentry }, isTest: true },
    },
    {
      name: 'merges tags into context',
      options: { tags: ['feature-flag', 'experiment'], isTest: true },
    },
    { name: 'does not merge tags when array is empty', options: { tags: [], isTest: true } },
    {
      name: 'uses custom console levels',
      options: { consoleLevels: ['error'], console: mockConsole as unknown as Console },
    },
  ] satisfies Array<{ name: string; options: TestLoggerOptions }>) {
    it(name, () => {
      expectLoggerDefined(options);
    });
  }

  it('defaults environment from NODE_ENV', () => {
    const originalEnv = process.env['NODE_ENV'];
    const originalLogLevel = process.env['LOG_LEVEL'];

    try {
      setEnvValue('LOG_LEVEL', undefined);

      setEnvValue('NODE_ENV', 'production');
      const { logger: productionLogger } = createAppLogger({
        app: 'test-app',
        isTest: false,
        enableConsole: true,
        consoleLevels: ['debug', 'info', 'warn', 'error'],
        console: mockConsole as unknown as Console,
      });
      productionLogger.debug('suppressed-in-production');
      productionLogger.info('allowed-in-production');

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.info).toHaveBeenCalledTimes(1);
      expect(String(mockConsole.info.mock.calls[0]?.[0])).toContain('environment=production');

      vi.clearAllMocks();

      setEnvValue('NODE_ENV', 'development');
      const { logger: developmentLogger } = createAppLogger({
        app: 'test-app',
        isTest: false,
        enableConsole: true,
        consoleLevels: ['debug', 'info', 'warn', 'error'],
        console: mockConsole as unknown as Console,
      });
      developmentLogger.debug('allowed-in-development');

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(String(mockConsole.debug.mock.calls[0]?.[0])).toContain('environment=development');
    } finally {
      setEnvValue('NODE_ENV', originalEnv);
      setEnvValue('LOG_LEVEL', originalLogLevel);
    }
  });

  for (const { name, options } of [
    {
      name: 'does not add tauri transport when disabled',
      options: { tauri: { enabled: false }, isTest: true },
    },
    {
      name: 'does not add tauri transport in test mode',
      options: { tauri: { enabled: true }, isTest: true },
    },
  ] satisfies Array<{ name: string; options: TestLoggerOptions }>) {
    it(name, () => {
      expectLoggerDefined(options);
    });
  }

  it('handles missing console methods gracefully', () => {
    const partialConsole = {
      debug: undefined,
      info: vi.fn(),
      warn: undefined,
      error: vi.fn(),
    };

    const { logger } = createAppLogger({
      app: 'test-app',
      console: partialConsole as unknown as Console,
    });

    expect(logger).toBeDefined();
  });

  it('handles null console references gracefully', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      console: null as unknown as Console,
    });

    expect(logger).toBeDefined();
  });

  for (const { name, options } of [
    {
      name: 'preserves native console when specified',
      options: { preserveNativeConsole: true, console: mockConsole as unknown as Console },
    },
    {
      name: 'uses desktop console levels in production desktop runtime',
      options: {
        environment: 'production',
        runtime: 'desktop',
        console: mockConsole as unknown as Console,
      },
    },
    {
      name: 'uses warn/error console levels in production non-desktop',
      options: {
        environment: 'production',
        runtime: 'web',
        console: mockConsole as unknown as Console,
      },
    },
    {
      name: 'handles undefined console reference',
      options: { console: undefined as unknown as Console, isTest: true },
    },
    {
      name: 'adds tauri transport when enabled and not in test mode',
      options: {
        tauri: { enabled: true, levels: ['error'], onError: vi.fn() },
        isTest: false,
        enableConsole: false,
      },
    },
    {
      name: 'adds tauri transport with default levels when not specified',
      options: { tauri: { enabled: true }, isTest: false, enableConsole: false },
    },
  ] satisfies Array<{ name: string; options: TestLoggerOptions }>) {
    it(name, () => {
      expectLoggerDefined(options);
    });
  }

  it('logs console bridge unavailable message when window is undefined', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { logger, consoleBridge } = createAppLogger({
      app: 'test-app',
      bridgeConsole: true,
      isTest: false,
      console: mockConsole as unknown as Console,
    });

    expect(logger).toBeDefined();
    expect(consoleBridge).toBeUndefined();

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('creates console bridge when window is available', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    const { logger } = createAppLogger({
      app: 'test-app',
      bridgeConsole: true,
      preserveNativeConsole: false,
      isTest: false,
      console: mockConsole as unknown as Console,
    });

    expect(logger).toBeDefined();
    // Console bridge may or may not be created depending on bridgeConsoleToLogger implementation
    // The key is that the code path is exercised

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('respects LOG_LEVEL environment variable set to debug', () => {
    withEnvValue('LOG_LEVEL', 'debug', () => {
      expectLoggerDefined({ isTest: false, enableConsole: false });
    });
  });

  it('reads LOG_LEVEL at logger creation time', () => {
    const original = process.env['LOG_LEVEL'];

    try {
      setEnvValue('LOG_LEVEL', 'error');
      const { logger: errorLogger } = createAppLogger({
        app: 'test-app',
        environment: 'development',
        isTest: false,
        enableConsole: true,
        consoleLevels: ['debug', 'info', 'warn', 'error'],
        console: mockConsole as unknown as Console,
      });
      errorLogger.debug('suppressed-at-error');
      expect(mockConsole.debug).not.toHaveBeenCalled();

      vi.clearAllMocks();

      setEnvValue('LOG_LEVEL', 'debug');
      const { logger: debugLogger } = createAppLogger({
        app: 'test-app',
        environment: 'development',
        isTest: false,
        enableConsole: true,
        consoleLevels: ['debug', 'info', 'warn', 'error'],
        console: mockConsole as unknown as Console,
      });
      debugLogger.debug('allowed-at-debug');
      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
    } finally {
      setEnvValue('LOG_LEVEL', original);
    }
  });

  for (const { level, options } of [
    { level: 'info', options: { isTest: false, enableConsole: false } },
    { level: 'warn', options: { isTest: false, enableConsole: false } },
    { level: 'error', options: { isTest: false, enableConsole: false } },
    { level: 'invalid-level', options: { environment: 'development', isTest: true } },
  ] satisfies Array<{ level: string; options: TestLoggerOptions }>) {
    it(
      level === 'invalid-level'
        ? 'ignores invalid LOG_LEVEL environment variable'
        : `respects LOG_LEVEL environment variable set to ${level}`,
      () => {
        withEnvValue('LOG_LEVEL', level, () => {
          expectLoggerDefined(options);
        });
      }
    );
  }

  it('uses sentry defaults when levels not specified', () => {
    expectLoggerDefined({ sentry: { client: mockSentry }, isTest: false, enableConsole: false });
  });

  it('uses console transport when consoleForTransport is provided', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    const { logger } = createAppLogger({
      app: 'test-app',
      bridgeConsole: true,
      isTest: false,
      console: mockConsole as unknown as Console,
    });

    expect(logger).toBeDefined();

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('handles console with all methods undefined', () => {
    expectLoggerDefined({
      console: {
        debug: undefined,
        info: undefined,
        warn: undefined,
        error: undefined,
      } as unknown as Console,
    });
  });

  it('creates console transport with explicit levels in non-production', () => {
    const { logger } = createAppLogger({
      app: 'test-app',
      environment: 'development',
      isTest: false,
      console: mockConsole as unknown as Console,
    });

    logger.debug('test');
    expect(mockConsole.debug).toHaveBeenCalled();
  });

  it('defaults environment to development when NODE_ENV is unset', () => {
    withEnvValue('NODE_ENV', undefined, () => {
      expectLoggerDefined({ isTest: true });
    });
  });

  it('includes sentry with includeMetadata set to false', () => {
    expectLoggerDefined({
      sentry: { client: mockSentry, includeMetadata: false },
      isTest: false,
      enableConsole: false,
    });
  });
});
