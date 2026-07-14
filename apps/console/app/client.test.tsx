import { describe, expect, it, vi } from 'bun:test';

const hydrateRoot = vi.fn();
const initConsoleClientSentry = vi.fn(() => Promise.resolve(true));
const scheduleClientSentryInit = vi.fn(({ init }: { init: () => void }) => init());
const loggerWarn = vi.fn();

vi.mock('@tanstack/react-start/client', () => ({
  StartClient: () => null,
}));

vi.mock('react-dom/client', () => ({
  hydrateRoot,
}));

vi.mock('./lib/observability/client-sentry', () => ({
  initConsoleClientSentry,
  scheduleClientSentryInit,
}));

vi.mock('./lib/logger', () => ({
  logger: { warn: loggerWarn },
}));

const importClient = () => import(`./client?test=${Date.now()}-${Math.random()}`);

describe('console client bootstrap', () => {
  it('hydrates the Start client', async () => {
    hydrateRoot.mockClear();

    await importClient();

    expect(hydrateRoot).toHaveBeenCalledWith(document, expect.any(Object));
    expect(scheduleClientSentryInit).toHaveBeenCalledWith({
      dsn: undefined,
      init: expect.any(Function),
    });
    expect(initConsoleClientSentry).toHaveBeenCalledWith({
      dsn: undefined,
      mode: 'development',
    });
  });

  it('logs deferred Sentry initialization failures', async () => {
    const error = new Error('Sentry unavailable');
    loggerWarn.mockClear();
    initConsoleClientSentry.mockRejectedValueOnce(error);

    await importClient();
    await Promise.resolve();

    expect(loggerWarn).toHaveBeenCalledWith('Failed to initialize client Sentry', { error });
  });
});
