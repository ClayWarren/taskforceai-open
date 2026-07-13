import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

import type { UsageStats } from './developer-dashboard';

const mockReadCachedUsageStats = vi.fn();
const mockRefreshUsageStats = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('./developer-dashboard', () => ({
  readCachedUsageStats: mockReadCachedUsageStats,
  refreshUsageStats: mockRefreshUsageStats,
}));

vi.mock('../logger', () => ({
  logger: { error: mockLoggerError },
}));

import { useDeveloperUsageStats } from './useDeveloperUsageStats';

const okResult = <T>(value: T) => ({ ok: true as const, value });
const errResult = (message: string, status = 500) => ({
  ok: false as const,
  error: { kind: 'server' as const, message, status },
});

const buildStats = (requestsThisMonth: number): UsageStats => ({
  totalRequests: requestsThisMonth * 10,
  requestsThisMonth,
  requestsThisWeek: 20,
  requestsToday: 3,
  monthlyQuota: 10_000,
  monthlyRemaining: 10_000 - requestsThisMonth,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-07-31T23:59:59.000Z',
  apiKeys: [],
  usageHistory: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const setVisibilityState = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
};

describe('useDeveloperUsageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadCachedUsageStats.mockReturnValue(errResult('No cache', 404));
    mockRefreshUsageStats.mockResolvedValue(okResult(buildStats(100)));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('waits for authentication and clears stats on logout', async () => {
    const { result, rerender } = renderHook(
      ({ isAuthenticated, isAuthLoading }) =>
        useDeveloperUsageStats({ isAuthenticated, isAuthLoading }),
      { initialProps: { isAuthenticated: false, isAuthLoading: true } }
    );

    expect(result.current).toMatchObject({ loading: true, stats: null });
    expect(mockReadCachedUsageStats).not.toHaveBeenCalled();
    expect(mockRefreshUsageStats).not.toHaveBeenCalled();

    rerender({ isAuthenticated: false, isAuthLoading: false });

    expect(result.current).toMatchObject({ loading: false, stats: null });
    expect(mockReadCachedUsageStats).not.toHaveBeenCalled();
  });

  it('hydrates cached stats before replacing them with the fresh response', async () => {
    const cachedStats = buildStats(120);
    const freshStats = buildStats(240);
    const refresh = deferred<ReturnType<typeof okResult<UsageStats>>>();
    mockReadCachedUsageStats.mockReturnValue(okResult(cachedStats));
    mockRefreshUsageStats.mockReturnValue(refresh.promise);

    const { result } = renderHook(() =>
      useDeveloperUsageStats({ isAuthenticated: true, isAuthLoading: false })
    );

    expect(result.current).toMatchObject({ loading: false, stats: cachedStats });

    await act(async () => {
      refresh.resolve(okResult(freshStats));
      await refresh.promise;
    });

    expect(result.current.stats).toBe(freshStats);
  });

  it('keeps only the latest refresh and invalidates pending work on logout', async () => {
    const firstStats = buildStats(100);
    const latestStats = buildStats(300);
    const staleStats = buildStats(50);
    const first = deferred<ReturnType<typeof okResult<UsageStats>>>();
    const latest = deferred<ReturnType<typeof okResult<UsageStats>>>();
    const stale = deferred<ReturnType<typeof okResult<UsageStats>>>();
    mockRefreshUsageStats
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise)
      .mockReturnValueOnce(stale.promise);

    const { result, rerender } = renderHook(
      ({ isAuthenticated, isAuthLoading }) =>
        useDeveloperUsageStats({ isAuthenticated, isAuthLoading }),
      { initialProps: { isAuthenticated: true, isAuthLoading: true } }
    );
    let firstResult!: ReturnType<typeof result.current.refresh>;
    let latestResult!: ReturnType<typeof result.current.refresh>;

    act(() => {
      firstResult = result.current.refresh();
      latestResult = result.current.refresh();
    });
    await act(async () => {
      latest.resolve(okResult(latestStats));
      await latest.promise;
    });
    await act(async () => {
      first.resolve(okResult(firstStats));
      await first.promise;
    });

    expect(await firstResult).toEqual(okResult(firstStats));
    expect(await latestResult).toEqual(okResult(latestStats));
    expect(result.current.stats).toBe(latestStats);

    let staleResult!: ReturnType<typeof result.current.refresh>;
    act(() => {
      staleResult = result.current.refresh();
    });
    rerender({ isAuthenticated: false, isAuthLoading: false });
    await act(async () => {
      stale.resolve(okResult(staleStats));
      await staleResult;
    });

    expect(result.current.stats).toBeNull();
  });

  it('logs result and thrown failures without replacing stats', async () => {
    const refreshError = errResult('Rate limited', 429);
    mockRefreshUsageStats.mockResolvedValueOnce(refreshError);

    const { result } = renderHook(() => useDeveloperUsageStats({ isAuthenticated: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toMatchObject({ loading: false, stats: null });
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to refresh usage stats', {
      message: 'Rate limited',
      status: 429,
    });

    const error = new Error('network unavailable');
    mockRefreshUsageStats.mockRejectedValueOnce(error);
    await act(async () => {
      await expect(result.current.refresh()).rejects.toBe(error);
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Unexpected failure while refreshing usage stats',
      { error }
    );
    expect(result.current.stats).toBeNull();
  });

  it('polls only while visible and does not overlap an active refresh', async () => {
    vi.useFakeTimers();
    setVisibilityState('visible');
    const pending = deferred<ReturnType<typeof okResult<UsageStats>>>();
    const { result } = renderHook(() =>
      useDeveloperUsageStats({
        isAuthenticated: true,
        refreshIntervalMs: 30_000,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockRefreshUsageStats).toHaveBeenCalledTimes(1);

    setVisibilityState('hidden');
    act(() => {
      vi.advanceTimersByTime(30_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockRefreshUsageStats).toHaveBeenCalledTimes(1);

    setVisibilityState('visible');
    mockRefreshUsageStats.mockReturnValueOnce(pending.promise);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(30_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockRefreshUsageStats).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.resolve(okResult(buildStats(400)));
      await pending.promise;
    });
    expect(result.current.stats?.requestsThisMonth).toBe(400);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(mockRefreshUsageStats).toHaveBeenCalledTimes(3);
  });

  it('removes polling listeners and ignores completion after unmount', async () => {
    vi.useFakeTimers();
    setVisibilityState('visible');
    const refresh = deferred<ReturnType<typeof okResult<UsageStats>>>();
    mockRefreshUsageStats.mockReturnValue(refresh.promise);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() =>
      useDeveloperUsageStats({ isAuthenticated: true, refreshIntervalMs: 30_000 })
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(30_000);
    });
    expect(mockRefreshUsageStats).toHaveBeenCalledTimes(1);

    await act(async () => {
      refresh.resolve(okResult(buildStats(500)));
      await refresh.promise;
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
