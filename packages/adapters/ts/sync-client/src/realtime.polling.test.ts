import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createRealtimeConnection } from './realtime';

import {
  getFetchUrl,
  invokeIntervalTick,
  isPollUrl,
  makeParams,
  mockFetch,
  toIntervalTick,
  waitForCondition,
} from './realtime.test-utils';

describe('sync-client/realtime polling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('backs off polling interval after consecutive idle polls', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const scheduledIntervals: number[] = [];
    const logger = { warn: mock(), debug: mock() };

    globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
      intervalTick = toIntervalTick(handler);
      scheduledIntervals.push(Number(timeout));
      return scheduledIntervals.length as unknown as ReturnType<typeof setInterval>;
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

      const disconnect = createRealtimeConnection(makeParams({ logger }));
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);
      await waitForCondition(() => scheduledIntervals.includes(6000));
      disconnect();

      expect(scheduledIntervals).toContain(3000);
      expect(scheduledIntervals).toContain(6000);
      expect(logger.debug).toHaveBeenCalledWith(
        'Updated sync poll interval',
        expect.objectContaining({ newInterval: 6000, reason: 'idle' })
      );
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('backs off polling interval after consecutive poll errors', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const scheduledIntervals: number[] = [];
    const logger = { warn: mock(), debug: mock() };

    globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
      intervalTick = toIntervalTick(handler);
      scheduledIntervals.push(Number(timeout));
      return scheduledIntervals.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'sync-token', expires_in: 120 }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

      const disconnect = createRealtimeConnection(makeParams({ logger }));
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 4);
      await waitForCondition(() => scheduledIntervals.includes(6000));
      disconnect();

      expect(scheduledIntervals).toContain(3000);
      expect(scheduledIntervals).toContain(6000);
      expect(logger.debug).toHaveBeenCalledWith(
        'Updated sync poll interval',
        expect.objectContaining({ newInterval: 6000, reason: 'error' })
      );
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('backs off polling interval after consecutive token fetch failures', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const scheduledIntervals: number[] = [];
    const logger = { warn: mock(), debug: mock() };

    globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
      intervalTick = toIntervalTick(handler);
      scheduledIntervals.push(Number(timeout));
      return scheduledIntervals.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = mock() as unknown as typeof clearInterval;

    try {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' })
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });

      const disconnect = createRealtimeConnection(makeParams({ logger }));
      await waitForCondition(() => mockFetch.mock.calls.length >= 1);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);
      await waitForCondition(() => scheduledIntervals.includes(6000));
      disconnect();

      expect(scheduledIntervals).toContain(3000);
      expect(scheduledIntervals).toContain(6000);
      expect(logger.debug).toHaveBeenCalledWith(
        'Updated sync poll interval',
        expect.objectContaining({ newInterval: 6000, reason: 'error' })
      );
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('returns polling interval to default when activity resumes', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const scheduledIntervals: number[] = [];
    const logger = { warn: mock(), debug: mock() };
    const onEvent = mock();

    globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
      intervalTick = toIntervalTick(handler);
      scheduledIntervals.push(Number(timeout));
      return scheduledIntervals.length as unknown as ReturnType<typeof setInterval>;
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
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            messages: [{ type: 'sync_required', version: 3, id: '3-0' }],
            lastId: '3-0',
          }),
        });

      const disconnect = createRealtimeConnection(makeParams({ logger, onEvent }));
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);
      await waitForCondition(() => scheduledIntervals.includes(6000));

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 4);
      await waitForCondition(() => onEvent.mock.calls.length > 0);
      await waitForCondition(() => scheduledIntervals.filter((ms) => ms === 3000).length >= 2);
      disconnect();

      expect(logger.debug).toHaveBeenCalledWith(
        'Updated sync poll interval',
        expect.objectContaining({ newInterval: 6000, reason: 'idle' })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Updated sync poll interval',
        expect.objectContaining({ newInterval: 3000, reason: 'activity' })
      );
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('does not start a second poll when one is already in flight', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    let resolvePollResponse!: (value: unknown) => void;
    const slowPollResponse = new Promise((resolve) => {
      resolvePollResponse = resolve;
    });

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
        .mockReturnValueOnce(slowPollResponse);

      const disconnect = createRealtimeConnection(makeParams());
      await waitForCondition(() => mockFetch.mock.calls.length >= 2);

      invokeIntervalTick(intervalTick);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(mockFetch.mock.calls).toHaveLength(2);

      resolvePollResponse({
        ok: true,
        json: async () => ({ messages: [], lastId: '$' }),
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      disconnect();
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('includes the last event id on later poll requests', async () => {
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
          json: async () => ({
            messages: [{ type: 'sync_required', version: 1, id: '8-0' }],
            lastId: '8-0',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ messages: [], lastId: '8-0' }),
        });

      const onEvent = mock();
      const disconnect = createRealtimeConnection(makeParams({ onEvent }));
      await waitForCondition(() => onEvent.mock.calls.length > 0);

      invokeIntervalTick(intervalTick);
      await waitForCondition(() => mockFetch.mock.calls.length >= 3);
      disconnect();

      const pollUrls = mockFetch.mock.calls.map((call) => getFetchUrl(call)).filter(isPollUrl);
      expect(pollUrls).toHaveLength(2);
      expect(pollUrls[0]).not.toContain('last_id=');
      expect(pollUrls[1]).toContain('last_id=8-0');
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('warns and emits no events when poll payload is invalid', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ type: 'sync_required' }],
          lastId: '4-0',
        }),
      });

    const onEvent = mock();
    const logger = { warn: mock(), debug: mock() };
    const disconnect = createRealtimeConnection(makeParams({ onEvent, logger }));

    await waitForCondition(() =>
      logger.warn.mock.calls.some((call) => call[0] === 'Sync poll error')
    );
    disconnect();

    expect(onEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Sync poll error', expect.any(Object));
  });

  it('emits realtime metrics for token fetches, polls, delivered messages, and disconnects', async () => {
    const stopTimer = mock();
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => stopTimer),
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'sync-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ type: 'sync_required', version: 1, id: '1-0' }],
          lastId: '1-0',
        }),
      });

    const onEvent = mock();
    const disconnect = createRealtimeConnection(makeParams({ metrics, onEvent }));

    await waitForCondition(() => onEvent.mock.calls.length > 0);
    disconnect();

    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'sync.client.realtime.connection.started'
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.token.success');
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.total');
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.success', {
      messages: 1,
    });
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'sync.client.realtime.message.delivered',
      { type: 'sync:required' }
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.connection.closed');
    expect(metrics.startTimer).toHaveBeenCalledWith('sync.client.realtime.token.duration');
    expect(metrics.startTimer).toHaveBeenCalledWith('sync.client.realtime.poll.duration');
    expect(stopTimer).toHaveBeenCalledTimes(2);
  });

  it('emits realtime metrics for malformed messages and failed polls', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalTick: unknown = null;
    const metrics = {
      incrementCounter: mock(),
      startTimer: mock(() => mock()),
    };

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
          json: async () => ({
            messages: [{ type: 'unknown_event_xyz', version: 1, id: '2-0' }],
            lastId: '2-0',
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });

      const disconnect = createRealtimeConnection(makeParams({ metrics }));
      await waitForCondition(() =>
        metrics.incrementCounter.mock.calls.some(
          (call) => call[0] === 'sync.client.realtime.message.dropped'
        )
      );

      invokeIntervalTick(intervalTick);
      await waitForCondition(() =>
        metrics.incrementCounter.mock.calls.some(
          (call) =>
            call[0] === 'sync.client.realtime.poll.failure' &&
            (call[1] as { status?: number } | undefined)?.status === 500
        )
      );
      disconnect();

      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'sync.client.realtime.message.dropped',
        { type: 'unknown_event_xyz', reason: 'parse_failure' }
      );
      expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.poll.failure', {
        status: 500,
        unauthorized: false,
      });
      expect(metrics.incrementCounter).toHaveBeenCalledWith('sync.client.realtime.token.cache_hit');
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
