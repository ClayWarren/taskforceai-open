import { describe, expect, it, vi } from 'bun:test';

import { bootstrapStatusClient } from './client-bootstrap';

const hydrateRoot = vi.fn();
const initStatusClientSentry = vi.fn(() => true);
const scheduleClientSentryInit = vi.fn(({ init }: { init: () => void }) => {
  init();
  return true;
});

describe('status client bootstrap', () => {
  it('hydrates the Start client', async () => {
    hydrateRoot.mockClear();
    initStatusClientSentry.mockClear();
    scheduleClientSentryInit.mockClear();
    const sentry = { init: vi.fn() };
    const startClient = <div data-testid="start-client" />;

    bootstrapStatusClient({
      documentTarget: document,
      startClient,
      hydrateRoot,
      sentry,
      dsn: undefined,
      mode: 'development',
      initStatusClientSentry,
      scheduleClientSentryInit,
    });

    expect(hydrateRoot).toHaveBeenCalledWith(document, startClient);
    expect(scheduleClientSentryInit).toHaveBeenCalledWith({
      dsn: undefined,
      init: expect.any(Function),
    });
    expect(initStatusClientSentry).toHaveBeenCalledWith({
      dsn: undefined,
      mode: 'development',
      sentry: expect.any(Object),
    });
  });
});
