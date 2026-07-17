import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { AppLoggerResult } from '@taskforceai/observability';

const addTransport = vi.fn();
const createSentryTransport = vi.fn();
const createStandardAppLogger = vi.fn();
const createTraceOperation = vi.fn(() => vi.fn());
const injectActiveTraceContext = vi.fn();
const isDesktopRuntime = vi.fn(() => false);

const logger = { addTransport } as unknown as AppLoggerResult['logger'];

vi.mock('@taskforceai/observability', () => ({
  createSentryTransport,
  createTraceOperation,
  injectActiveTraceContext,
}));
vi.mock('@taskforceai/observability/standard-logger', () => ({ createStandardAppLogger }));

vi.mock('@taskforceai/browser-runtime/runtime', () => ({ isDesktopRuntime }));

const originalMode = import.meta.env.MODE;

const importLogger = async (mode: string) => {
  import.meta.env.MODE = mode;
  return import(`./logger?mode=${mode}&test=${Date.now()}-${Math.random()}`);
};

describe('console logger', () => {
  beforeEach(() => {
    addTransport.mockReset();
    createSentryTransport.mockReset();
    createStandardAppLogger.mockReset();
    createStandardAppLogger.mockReturnValue({ logger });
  });

  afterEach(() => {
    import.meta.env.MODE = originalMode;
  });

  it('creates the base logger without eagerly attaching Sentry', async () => {
    await importLogger('production');

    expect(createStandardAppLogger).toHaveBeenCalledWith({
      app: 'console',
      environment: 'production',
      isDesktop: false,
    });
    expect(createSentryTransport).not.toHaveBeenCalled();
  });

  it('installs the Sentry transport once after deferred initialization', async () => {
    const sentry = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      withScope: vi.fn(),
    };
    const transport = { name: 'sentry' };
    createSentryTransport.mockReturnValue(transport);
    const module = await importLogger('production');

    module.installSentryLoggerTransport(sentry);
    module.installSentryLoggerTransport(sentry);

    expect(createSentryTransport).toHaveBeenCalledTimes(1);
    expect(addTransport).toHaveBeenCalledWith(transport);
  });
});
