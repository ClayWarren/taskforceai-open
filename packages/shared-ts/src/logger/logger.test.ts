import { describe, expect, it } from 'bun:test';

import { Logger } from './logger';
import type { LogEntry, LogTransport } from './types';

describe('shared/logger/logger', () => {
  it('applies levels, context updates, buffer limits, and transport clearing', () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      level: 'info',
      maxBufferSize: 2,
      context: { scope: 'root' },
      transports: [
        {
          name: 'memory',
          log: (entry) => {
            entries.push(entry);
          },
        },
      ],
    });

    logger.debug('hidden');
    logger.info('first');
    logger.setContext({ scope: 'replacement' });
    logger.mergeContext({ requestId: 'req-1' });
    logger.warn('second');
    logger.error('third');
    logger.clearTransports();
    logger.error('after clear');

    expect(entries.map((entry) => entry.message)).toEqual(['first', 'second', 'third']);
    expect(entries[0]?.context).toEqual({ scope: 'root' });
    expect(entries[1]?.context).toEqual({ scope: 'replacement', requestId: 'req-1' });
    expect(logger.getBuffer().map((entry) => entry.message)).toEqual(['third', 'after clear']);

    logger.clearBuffer();
    expect(logger.getBuffer()).toEqual([]);
  });

  it('normalizes primitive and circular metadata without breaking logging', () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      transports: [
        {
          name: 'memory',
          log: (entry) => {
            entries.push(entry);
          },
        },
      ],
    });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    logger.setLevel('debug');
    logger.debug('primitive', 'detail');
    logger.warn('circular', circular);

    expect(entries[0]?.metadata).toEqual({ value: 'detail' });
    expect(entries[1]?.metadata).toEqual({ self: '[Circular]' });
  });

  it('awaits asynchronous transport flush operations', async () => {
    let resolveFlush: (() => void) | undefined;

    const transport: LogTransport = {
      name: 'async-transport',
      log: () => {},
      flush: () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    };

    const logger = new Logger({ transports: [transport] });

    let settled = false;
    const pending = logger.flush().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveFlush?.();
    await pending;

    expect(settled).toBe(true);
  });

  it('keeps child transport mutations isolated from parent logger', () => {
    let childTransportCalls = 0;

    const root = new Logger();
    const child = root.child({ scope: 'child' });
    child.addTransport({
      name: 'child-transport',
      log: () => {
        childTransportCalls += 1;
      },
    });

    root.error('root error');
    expect(childTransportCalls).toBe(0);

    child.error('child error');
    expect(childTransportCalls).toBe(1);
  });

  it('does not throw when transport fails without process.stderr', () => {
    const originalProcess = globalThis.process;

    Reflect.deleteProperty(globalThis, 'process');

    try {
      const logger = new Logger({
        transports: [
          {
            name: 'broken-transport',
            log: () => {
              throw new Error('transport failure');
            },
          },
        ],
      });

      expect(() => logger.info('message')).not.toThrow();
    } finally {
      if (originalProcess === undefined) {
        Reflect.deleteProperty(globalThis, 'process');
      } else {
        globalThis.process = originalProcess;
      }
    }
  });
});
