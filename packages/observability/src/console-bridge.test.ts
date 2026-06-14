import { afterEach, describe, expect, it, vi } from 'bun:test';

import { Logger } from '@taskforceai/shared/logger';

import { setupConsoleBridge } from './console-bridge';

const originalWindow = globalThis.window;
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

const restoreGlobals = () => {
  Object.assign(console, originalConsole);
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
};

describe('setupConsoleBridge', () => {
  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('returns bridged console methods when browser window is available', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });

    const logger = new Logger({ level: 'debug' });

    const result = setupConsoleBridge({
      logger,
      bridgeConsole: true,
      preserveNativeConsole: false,
      environment: 'test',
      runtime: 'desktop',
      consoleLevels: ['debug', 'info', 'warn', 'error'],
    });

    expect(result.consoleBridge).toBeDefined();
    expect(result.consoleForTransport?.debug).toBeFunction();
    expect(result.consoleForTransport?.info).toBeFunction();
    expect(result.consoleForTransport?.warn).toBeFunction();
    expect(result.consoleForTransport?.error).toBeFunction();

    result.consoleBridge?.restore();
  });

  it('logs a debug message when browser window is unavailable', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const logger = {
      debug: vi.fn(),
    };

    const result = setupConsoleBridge({
      logger: logger as unknown as Logger,
      bridgeConsole: true,
      preserveNativeConsole: true,
      environment: 'test',
      runtime: 'server',
      consoleLevels: ['error'],
    });

    expect(result).toEqual({});
    expect(logger.debug).toHaveBeenCalledWith(
      'Console bridging requested but window is unavailable; skipping bridge',
      {
        environment: 'test',
        runtime: 'server',
      }
    );
  });
});
