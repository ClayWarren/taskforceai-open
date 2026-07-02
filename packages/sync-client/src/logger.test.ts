import { beforeEach, describe, expect, it, vi } from 'bun:test';

vi.mock('@taskforceai/logger', () => {
  type LoggedEntry = {
    level: string;
    message: string;
    context: Record<string, unknown>;
    metadata?: unknown;
  };
  const recorded: LoggedEntry[] = [];
  return {
    createConsoleTransport: vi.fn((config) => ({ type: 'console', config })),
    Logger: class {
      level: string;
      context: Record<string, unknown>;
      transports: unknown[];
      buffer: LoggedEntry[] = recorded;
      constructor(options: { level: string; context: Record<string, unknown> }) {
        this.level = options.level;
        this.context = options.context;
        this.transports = [];
      }
      addTransport(transport: unknown) {
        this.transports.push(transport);
      }
      info(message: string, metadata?: unknown) {
        this.buffer.push({ level: 'info', message, context: this.context, metadata });
      }
      getBuffer() {
        return this.buffer;
      }
    },
  };
});

const isLoggerWithTestSurface = (
  value: unknown
): value is { transports: unknown[]; getBuffer: () => unknown[] } =>
  typeof value === 'object' &&
  value !== null &&
  'transports' in value &&
  Array.isArray((value as Record<string, unknown>)['transports']) &&
  'getBuffer' in value &&
  typeof (value as Record<string, unknown>)['getBuffer'] === 'function';

describe('sync logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a singleton logger with transports and records context', async () => {
    const { getSyncLogger } = await import(`./logger?ts=${Date.now()}`);
    const loggerA = getSyncLogger();
    const loggerB = getSyncLogger();
    loggerA.info('hello', { scope: 'sync' });
    expect(loggerA).toBe(loggerB);
    if (!isLoggerWithTestSurface(loggerA)) {
      throw new Error('Expected logger mock to expose transports and getBuffer');
    }
    expect(loggerA.transports).toHaveLength(1);
    expect(loggerA.getBuffer()).toEqual([
      {
        level: 'info',
        message: 'hello',
        context: { component: 'sync-client' },
        metadata: { scope: 'sync' },
        timestamp: expect.any(String),
      },
    ]);
  });
});
