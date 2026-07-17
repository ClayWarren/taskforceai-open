import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { bridgeConsoleToLogger } from './console-bridge';
import { Logger } from './logger';
import type { LogEntry, LogTransport } from './types';
import { CONSOLE_BRIDGE_METADATA_KEY } from './types';

const createCapturingLogger = () => {
  const entries: LogEntry[] = [];
  const transport: LogTransport = {
    name: 'capture',
    log(entry) {
      entries.push(entry);
    },
  };
  const logger = new Logger({ transports: [transport], level: 'debug' });
  return { logger, entries };
};

describe('client-core/logger/console-bridge', () => {
  const originalConsole = globalThis.console;

  beforeEach(() => {
    globalThis.console = {
      ...originalConsole,
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as Console;
  });

  afterEach(() => {
    globalThis.console = originalConsole;
    vi.restoreAllMocks();
  });

  it('bridges console methods into structured logger metadata and preserves native calls', () => {
    const { logger, entries } = createCapturingLogger();
    const nativeLogSpy = vi.spyOn(console, 'log');
    const nativeErrorSpy = vi.spyOn(console, 'error');

    const handle = bridgeConsoleToLogger(logger, { levels: ['info', 'error'] });
    expect(handle).toBeDefined();

    console.log('log message', { detail: 'A' });
    console.debug('debug ignored');
    console.error(new Error('boom'));

    expect(entries).toHaveLength(2);

    const logEntry = entries[0];
    expect(logEntry?.level).toBe('info');
    expect(logEntry?.message).toBe('log message');
    expect(logEntry?.metadata).toEqual(
      expect.objectContaining({
        consoleMethod: 'log',
        consoleArgs: ['log message', { detail: 'A' }],
        rest: [{ detail: 'A' }],
        [CONSOLE_BRIDGE_METADATA_KEY]: true,
      })
    );

    const errorEntry = entries[1];
    expect(errorEntry?.level).toBe('error');
    expect(errorEntry?.message).toBe('boom');
    expect(errorEntry?.metadata).toEqual(
      expect.objectContaining({
        consoleMethod: 'error',
        [CONSOLE_BRIDGE_METADATA_KEY]: true,
      })
    );

    expect(nativeLogSpy).toHaveBeenCalledWith('log message', { detail: 'A' });
    expect(nativeErrorSpy).toHaveBeenCalled();

    if (!handle) {
      throw new Error('Expected console bridge handle');
    }
    handle.restore();
    expect(console.log).toBe(handle.console.log);
  });

  it('supports preserveNative=false and custom message formatter', () => {
    const { logger, entries } = createCapturingLogger();

    const nativeWarnSpy = vi.spyOn(globalThis.console, 'warn');
    const handle = bridgeConsoleToLogger(logger, {
      levels: ['warn'],
      preserveNative: false,
      formatMessage: (args) => ({
        message: `custom:${String(args[0])}`,
        metadata: { size: args.length },
      }),
    });

    console.warn('hello', 123, true);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'custom:hello',
        metadata: expect.objectContaining({
          size: 3,
          consoleMethod: 'warn',
          consoleArgs: ['hello', 123, true],
        }),
      })
    );

    expect(nativeWarnSpy).toHaveBeenCalledTimes(0);
    handle?.restore();
  });

  it('returns undefined when console is unavailable', () => {
    const { logger } = createCapturingLogger();

    Reflect.deleteProperty(globalThis, 'console');

    const handle = bridgeConsoleToLogger(logger);
    expect(handle).toBeUndefined();

    globalThis.console = originalConsole;
  });

  it('formats non-serializable values without throwing', () => {
    const { logger, entries } = createCapturingLogger();

    const circular: { self?: unknown; value: string } = { value: 'x' };
    circular.self = circular;

    bridgeConsoleToLogger(logger, { levels: ['info'] });
    console.info(circular);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain('[object Object]');
    expect(entries[0]?.metadata).toEqual(
      expect.objectContaining({
        consoleMethod: 'info',
      })
    );
  });

  it('normalizes undefined console payloads into string messages', () => {
    const { logger, entries } = createCapturingLogger();

    bridgeConsoleToLogger(logger, { levels: ['info'], preserveNative: false });
    console.log(undefined);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('undefined');
  });

  it('formats empty calls and serializable objects with the default formatter', () => {
    const { logger, entries } = createCapturingLogger();

    bridgeConsoleToLogger(logger, { levels: ['info'], preserveNative: false });
    console.info();
    console.log({ ready: true });

    expect(entries.map((entry) => entry.message)).toEqual(['[console]', '{"ready":true}']);
  });
});
