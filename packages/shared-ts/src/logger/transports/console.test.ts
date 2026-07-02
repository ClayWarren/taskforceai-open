import { describe, expect, it, vi } from 'bun:test';

import { CONSOLE_BRIDGE_METADATA_KEY } from '../types';
import { createConsoleTransport } from './console';

describe('shared/logger/transports/console', () => {
  it('writes formatted entries with timestamp, context, and metadata', () => {
    const consoleRef = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport({ console: consoleRef, includeTimestamp: true });

    transport.log({
      level: 'warn',
      message: 'quota near limit',
      timestamp: '2026-06-13T12:00:00.000Z',
      context: { requestId: 'req-1', attempt: 2 },
      metadata: { remaining: 1 },
    });

    expect(consoleRef.warn).toHaveBeenCalledWith(
      '[2026-06-13T12:00:00.000Z] [WARN] requestId=req-1 attempt=2 quota near limit',
      { remaining: 1 }
    );
  });

  it('skips disabled levels and tolerates console failures', () => {
    const consoleRef = {
      debug: vi.fn(),
      info: vi.fn(() => {
        throw new Error('console unavailable');
      }),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport({ console: consoleRef, levels: ['info'] });

    transport.log({
      level: 'debug',
      message: 'hidden',
      timestamp: new Date().toISOString(),
    });
    expect(() =>
      transport.log({
        level: 'info',
        message: 'visible',
        timestamp: new Date().toISOString(),
      })
    ).not.toThrow();

    expect(consoleRef.debug).not.toHaveBeenCalled();
    expect(consoleRef.info).toHaveBeenCalledTimes(1);
  });

  it('skips bridged console entries to prevent recursive logging', () => {
    const consoleRef = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport({ console: consoleRef });

    transport.log({
      level: 'info',
      message: 'loop candidate',
      timestamp: new Date().toISOString(),
      metadata: {
        [CONSOLE_BRIDGE_METADATA_KEY]: true,
      },
    });

    expect(consoleRef.info).not.toHaveBeenCalled();
  });

  it('strips internal bridge metadata before writing', () => {
    const consoleRef = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport({ console: consoleRef });

    transport.log({
      level: 'info',
      message: 'safe',
      timestamp: new Date().toISOString(),
      metadata: {
        [CONSOLE_BRIDGE_METADATA_KEY]: false,
        scope: 'test',
      },
    });

    expect(consoleRef.info).toHaveBeenCalledTimes(1);
    const metadataArg = consoleRef.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(metadataArg?.[CONSOLE_BRIDGE_METADATA_KEY]).toBeUndefined();
    expect(metadataArg?.['scope']).toBe('test');
  });

  it('formats entries without context as bare messages', () => {
    const consoleRef = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport({ console: consoleRef });

    transport.log({
      level: 'info',
      message: 'ready',
      timestamp: new Date().toISOString(),
      context: {},
    });

    expect(consoleRef.info).toHaveBeenCalledWith('[INFO] ready');
  });
});
