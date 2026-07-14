import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createRealtimeConnection } from './realtime';

import {
  getFetchUrl,
  invokeIntervalTick,
  isPollUrl,
  isTokenUrl,
  makeParams,
  mockFetch,
  toIntervalTick,
  waitForCondition,
} from './realtime.test-utils';

describe('sync-client/realtime', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('emits sync:required from polling payloads that use sync_required', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ type: 'sync_required', version: 10, id: '1-0' }],
          lastId: '1-0',
        }),
      });

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent }));

    await waitForCondition(() => onEvent.mock.calls.length > 0);
    disconnect();

    expect(onEvent).toHaveBeenCalledWith({ type: 'sync:required' });
  });

  it('normalizes legacy polling event type aliases', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              type: 'conversation_created',
              version: 1,
              id: '1-0',
              userId: 'user-1',
              conversationId: 10,
            },
            {
              type: 'conversation_updated',
              version: 2,
              id: '2-0',
              userId: 'user-1',
              conversationId: 11,
            },
            {
              type: 'conversation_deleted',
              version: 3,
              id: '3-0',
              userId: 'user-1',
              conversationId: 12,
            },
            {
              type: 'message_created',
              version: 4,
              id: '4-0',
              userId: 'user-1',
              conversationId: 13,
              messageId: 'msg-13',
            },
            {
              type: 'message_updated',
              version: 5,
              id: '5-0',
              userId: 'user-1',
              conversationId: 14,
              messageId: 'msg-14',
            },
            {
              type: 'message_deleted',
              version: 6,
              id: '6-0',
              userId: 'user-1',
              messageId: 'msg-15',
            },
          ],
          lastId: '6-0',
        }),
      });

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent }));

    await waitForCondition(() => onEvent.mock.calls.length === 6);
    disconnect();

    expect(onEvent.mock.calls.map((call) => call[0])).toEqual([
      { type: 'conversation:created', userId: 'user-1', conversationId: 10 },
      { type: 'conversation:updated', userId: 'user-1', conversationId: 11 },
      { type: 'conversation:deleted', userId: 'user-1', conversationId: 12 },
      {
        type: 'message:created',
        userId: 'user-1',
        conversationId: 13,
        messageId: 'msg-13',
      },
      {
        type: 'message:updated',
        userId: 'user-1',
        conversationId: 14,
        messageId: 'msg-14',
      },
      { type: 'message:deleted', userId: 'user-1', messageId: 'msg-15' },
    ]);
  });

  it('passes through full message payload when available', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              type: 'message_created',
              version: 11,
              id: '2-0',
              userId: 'user-1',
              conversationId: 7,
              messageId: 'msg-1',
            },
          ],
          lastId: '2-0',
        }),
      });

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent }));

    await waitForCondition(() => onEvent.mock.calls.length > 0);
    disconnect();

    expect(onEvent).toHaveBeenCalledWith({
      type: 'message:created',
      userId: 'user-1',
      conversationId: 7,
      messageId: 'msg-1',
    });
  });

  it('skips polling when Authorization header is missing or guest', async () => {
    const onEvent = mock();
    const notifyUnauthorized = mock();
    const disconnect = createRealtimeConnection(
      makeParams({
        onEvent,
        notifyUnauthorized,
        buildHeaders: async () => ({ Authorization: 'Bearer null' }),
      })
    );

    // Give the poll a chance to run
    await new Promise((r) => setTimeout(r, 50));
    disconnect();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('calls notifyUnauthorized and does not emit events on 401 token response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });

    const onEvent = mock();
    const notifyUnauthorized = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent, notifyUnauthorized }));

    await waitForCondition(() => notifyUnauthorized.mock.calls.length > 0);
    disconnect();

    expect(notifyUnauthorized).toHaveBeenCalledWith('realtime-token');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('closes realtime polling after an unauthorized token response', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const clearIntervalMock = mock();

    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof clearInterval;

    try {
      mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });

      const notifyUnauthorized = mock();
      const disconnect = createRealtimeConnection(makeParams({ notifyUnauthorized }));

      await waitForCondition(() => notifyUnauthorized.mock.calls.length > 0);
      invokeIntervalTick(intervalTick);
      await new Promise((resolve) => setTimeout(resolve, 25));
      disconnect();

      expect(notifyUnauthorized).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).toHaveBeenCalledWith('realtime-token');
      expect(mockFetch.mock.calls.map((call) => getFetchUrl(call)).filter(isTokenUrl)).toHaveLength(
        1
      );
      expect(clearIntervalMock).toHaveBeenCalled();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('adds CSRF token header when fetching realtime tokens', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [], lastId: '$' }),
      });

    const disconnect = createRealtimeConnection(
      makeParams({ getCsrfToken: async () => 'csrf-token' })
    );

    await waitForCondition(() =>
      mockFetch.mock.calls.some((call) => isTokenUrl(getFetchUrl(call)))
    );
    disconnect();

    const tokenCall = mockFetch.mock.calls.find((call) => isTokenUrl(getFetchUrl(call)));
    const init = tokenCall?.[1] as RequestInit | undefined;
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer token',
        'X-CSRF-Token': 'csrf-token',
      })
    );
  });

  it('skips polling and records metrics when token response has no token', async () => {
    const stopTimer = mock();
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => stopTimer),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ metrics, onEvent }));

    await waitForCondition(() =>
      metrics.incrementCounter.mock.calls.some(
        (call) =>
          call[0] === 'sync.client.realtime.poll.skipped' &&
          (call[1] as { reason?: string } | undefined)?.reason === 'missing_token'
      )
    );
    disconnect();

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.map((call) => getFetchUrl(call)).filter(isPollUrl)).toHaveLength(0);
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.token.failure', {
      reason: 'missing_token',
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.skipped', {
      reason: 'missing_token',
    });
    expect(stopTimer).toHaveBeenCalled();
  });

  it('skips polling and records metrics when token fetch throws', async () => {
    const tokenError = new Error('network unavailable');
    const stopTimer = mock();
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => stopTimer),
    };
    const logger = { warn: mock(), debug: mock() };
    mockFetch.mockRejectedValueOnce(tokenError);

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ metrics, logger, onEvent }));

    await waitForCondition(() =>
      metrics.incrementCounter.mock.calls.some(
        (call) =>
          call[0] === 'sync.client.realtime.token.failure' &&
          (call[1] as { reason?: string } | undefined)?.reason === 'exception'
      )
    );
    disconnect();

    expect(onEvent).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.map((call) => getFetchUrl(call)).filter(isPollUrl)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('Failed to fetch sync realtime token', {
      error: tokenError,
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.token.failure', {
      reason: 'exception',
      error: 'Error',
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.skipped', {
      reason: 'missing_token',
    });
    expect(stopTimer).toHaveBeenCalled();
  });

  it('throttles warnings for repeated non-auth token failures', async () => {
    const originalDateNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let now = 60_000;
    let intervalTick: unknown = null;
    const logger = { warn: mock(), debug: mock() };

    Date.now = () => now;
    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });

      const disconnect = createRealtimeConnection(makeParams({ logger }));
      await waitForCondition(() => mockFetch.mock.calls.length >= 1);

      now += 1_000;
      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);
      disconnect();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith('Unable to fetch sync realtime token', {
        status: 503,
        statusText: 'Unavailable',
      });
    } finally {
      Date.now = originalDateNow;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('calls notifyUnauthorized on 401 poll response', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });

    const onEvent = mock();
    const notifyUnauthorized = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent, notifyUnauthorized }));

    await waitForCondition(() => notifyUnauthorized.mock.calls.length > 0);
    disconnect();

    expect(notifyUnauthorized).toHaveBeenCalledWith('realtime-poll');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('treats production 504 poll responses as empty long-poll timeouts', async () => {
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };
    const logger = { warn: mock(), debug: mock() };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 504, statusText: 'Gateway Timeout' });

    const disconnect = createRealtimeConnection(
      makeParams({ metrics, logger, isProduction: true })
    );

    await waitForCondition(() =>
      metrics.incrementCounter.mock.calls.some(
        (call) =>
          call[0] === 'sync.client.realtime.poll.success' &&
          (call[1] as { timeout?: boolean } | undefined)?.timeout === true
      )
    );
    disconnect();

    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.success', {
      messages: 0,
      timeout: true,
    });
    expect(logger.warn).not.toHaveBeenCalledWith('Sync poll request failed', expect.any(Object));
  });

  it('closes realtime polling after an unauthorized poll response', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const clearIntervalMock = mock();

    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = clearIntervalMock as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token' }),
        })
        .mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });

      const notifyUnauthorized = mock();
      const disconnect = createRealtimeConnection(makeParams({ notifyUnauthorized }));

      await waitForCondition(() => notifyUnauthorized.mock.calls.length > 0);
      invokeIntervalTick(intervalTick);
      await new Promise((resolve) => setTimeout(resolve, 25));
      disconnect();

      expect(notifyUnauthorized).toHaveBeenCalledTimes(1);
      expect(notifyUnauthorized).toHaveBeenCalledWith('realtime-poll');
      expect(mockFetch.mock.calls.map((call) => getFetchUrl(call)).filter(isPollUrl)).toHaveLength(
        1
      );
      expect(clearIntervalMock).toHaveBeenCalled();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('warns and drops malformed events without crashing', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // 'unknown_event_xyz' is not a recognised broadcast event type
          messages: [{ type: 'unknown_event_xyz', version: 1, id: '3-0' }],
          lastId: '3-0',
        }),
      });

    const onEvent = mock();
    const logger = { warn: mock(), debug: mock() };
    const disconnect = createRealtimeConnection(makeParams({ onEvent, logger }));

    await waitForCondition(() => logger.warn.mock.calls.length > 0);
    disconnect();

    expect(onEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropping malformed sync message',
      expect.objectContaining({ type: 'unknown_event_xyz' })
    );
  });

  it('does not emit events after disconnect is called', async () => {
    // Simulate a slow poll response
    let resolveResponse!: (v: unknown) => void;
    const responsePromise = new Promise((r) => {
      resolveResponse = r;
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockReturnValueOnce(responsePromise);

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ onEvent }));

    // Disconnect before the poll response resolves
    disconnect();

    // Now resolve the response
    resolveResponse({
      ok: true,
      json: async () => ({
        messages: [{ type: 'sync_required', version: 1, id: '4-0' }],
        lastId: '4-0',
      }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reuses sync token across poll ticks while still fresh', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;

    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token', expires_in: 120 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        });

      const disconnect = createRealtimeConnection(makeParams());

      await waitForCondition(() => mockFetch.mock.calls.length >= 2);
      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);
      disconnect();

      const urls = mockFetch.mock.calls.map((call) => getFetchUrl(call));
      const tokenCalls = urls.filter((url) => isTokenUrl(url));
      const pollCalls = urls.filter((url) => isPollUrl(url));

      expect(tokenCalls).toHaveLength(1);
      expect(pollCalls).toHaveLength(2);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('refreshes sync token when Authorization header changes', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    let authHeader = 'Bearer token-1';

    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token-1', expires_in: 120 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token-2', expires_in: 120 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        });

      const disconnect = createRealtimeConnection(
        makeParams({
          buildHeaders: async () => ({ Authorization: authHeader }),
        })
      );

      await waitForCondition(() => mockFetch.mock.calls.length >= 2);
      authHeader = 'Bearer token-2';
      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 4);
      disconnect();

      const tokenCalls = mockFetch.mock.calls
        .map((call) => getFetchUrl(call))
        .filter((url) => isTokenUrl(url));
      const pollCalls = mockFetch.mock.calls
        .map((call) => getFetchUrl(call))
        .filter((url) => isPollUrl(url));

      expect(tokenCalls).toHaveLength(2);
      expect(pollCalls).toHaveLength(2);
      expect(pollCalls[0]).toContain('sync_token=sync-token-1');
      expect(pollCalls[1]).toContain('sync_token=sync-token-2');
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('refreshes sync token after cached token expires', async () => {
    const originalDateNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let now = 0;
    let intervalTick: unknown = null;

    Date.now = () => now;
    globalThis.setInterval = ((handler: TimerHandler) => {
      intervalTick = toIntervalTick(handler);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token-1', expires_in: 2 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token-2', expires_in: 2 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '$' }),
        });

      const disconnect = createRealtimeConnection(makeParams());
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);

      now = 3_000;
      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 5);
      disconnect();

      const tokenCalls = mockFetch.mock.calls
        .map((call) => getFetchUrl(call))
        .filter((url) => isTokenUrl(url));

      expect(tokenCalls).toHaveLength(2);
    } finally {
      Date.now = originalDateNow;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
