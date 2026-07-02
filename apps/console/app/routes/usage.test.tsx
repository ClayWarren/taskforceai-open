import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

import type { UsageStats } from '../lib/developer/developer-dashboard';

const mockUseAuth = vi.fn();
const mockGetSignInUrl = vi.fn();
const mockReadCachedUsageStats = vi.fn();
const mockRefreshUsageStats = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../lib/providers/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('../lib/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('../lib/developer/developer-dashboard', () => ({
  readCachedUsageStats: mockReadCachedUsageStats,
  refreshUsageStats: mockRefreshUsageStats,
}));

vi.mock('../lib/logger', () => ({
  logger: {
    error: mockLoggerError,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => options,
}));

import { Route } from './usage';

const getUsagePageComponent = () => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const UsagePage = route.options?.component ?? route.component;
  if (!UsagePage) {
    throw new Error('usage route component is unavailable');
  }
  return UsagePage;
};

const renderUsagePage = () => {
  const UsagePage = getUsagePageComponent();
  return render(<UsagePage />);
};

const okResult = <T,>(value: T) => ({ ok: true as const, value });
const errResult = (message: string, status = 500) => ({
  ok: false as const,
  error: { kind: 'server', message, status },
});
type UsageStatsResult = ReturnType<typeof okResult<UsageStats>>;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const buildStats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totalRequests: 5000,
  requestsThisMonth: 300,
  requestsThisWeek: 90,
  requestsToday: 8,
  monthlyQuota: 10_000,
  monthlyRemaining: 9700,
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-02-28T23:59:59.000Z',
  apiKeys: [],
  usageHistory: [
    { date: '2026-02-10T00:00:00.000Z', count: 10 },
    { date: '2026-02-11T00:00:00.000Z', count: 20 },
    { date: '2026-02-12T00:00:00.000Z', count: 30 },
  ],
  ...overrides,
});

const readStatValue = (label: string) => {
  const labelElement = screen.getByText(label);
  const parent = labelElement.parentElement;
  if (!parent) return '';
  const values = parent.querySelectorAll('p');
  return values[1]?.textContent ?? '';
};

describe('usage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
    const stats = buildStats();
    mockReadCachedUsageStats.mockReturnValue(okResult(stats));
    mockRefreshUsageStats.mockResolvedValue(okResult(stats));
    window.location.href = 'http://localhost/';
  });

  it('renders sign-in gate for unauthenticated users', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });

    renderUsagePage();

    expect(screen.getByText('Usage Metrics')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Sign in to track your API consumption, monitor spending, and view detailed usage history.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: expect.stringContaining('http://localhost'),
    });
  });

  it('hydrates from cached stats and then updates from refresh response', async () => {
    const cachedStats = buildStats({
      totalRequests: 1000,
      requestsThisMonth: 120,
      usageHistory: [
        { date: '2026-02-01T00:00:00.000Z', count: 4 },
        { date: '2026-02-02T00:00:00.000Z', count: 8 },
      ],
    });
    const refreshedStats = buildStats({
      totalRequests: 4000,
      requestsThisMonth: 450,
      usageHistory: [
        { date: '2026-02-03T00:00:00.000Z', count: 12 },
        { date: '2026-02-04T00:00:00.000Z', count: 18 },
        { date: '2026-02-05T00:00:00.000Z', count: 24 },
      ],
    });

    let resolveRefresh: ((value: UsageStatsResult) => void) | undefined;
    const refreshPromise = new Promise<UsageStatsResult>((resolve) => {
      resolveRefresh = resolve;
    });

    mockReadCachedUsageStats.mockReturnValue(okResult(cachedStats));
    mockRefreshUsageStats.mockReturnValue(refreshPromise);

    const { container } = renderUsagePage();

    expect(readStatValue('Requests This Month')).toBe('120');
    expect(container.querySelectorAll('div.cursor-pointer').length).toBe(2);

    resolveRefresh?.(okResult(refreshedStats));

    await waitFor(() => {
      expect(readStatValue('Requests This Month')).toBe('450');
    });
    expect(readStatValue('Total Requests')).toBe('4,000');
    expect(container.querySelectorAll('div.cursor-pointer').length).toBe(3);
  });

  it('ignores stale refresh responses after auth state changes', async () => {
    const staleRefresh = deferred<UsageStatsResult>();
    const freshRefresh = deferred<UsageStatsResult>();
    const staleStats = buildStats({ requestsThisMonth: 111, totalRequests: 1111 });
    const freshStats = buildStats({ requestsThisMonth: 900, totalRequests: 9000 });

    mockReadCachedUsageStats.mockReturnValueOnce(okResult(staleStats));
    mockRefreshUsageStats.mockReturnValueOnce(staleRefresh.promise);

    const UsagePage = getUsagePageComponent();
    const { rerender } = render(<UsagePage />);

    expect(readStatValue('Requests This Month')).toBe('111');

    mockUseAuth.mockReturnValue({ isAuthenticated: false });
    rerender(<UsagePage />);

    expect(screen.getByText('Usage Metrics')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    mockReadCachedUsageStats.mockReturnValueOnce(okResult(freshStats));
    mockRefreshUsageStats.mockReturnValueOnce(freshRefresh.promise);
    rerender(<UsagePage />);

    await act(async () => {
      freshRefresh.resolve(okResult(freshStats));
      await freshRefresh.promise;
    });

    await waitFor(() => {
      expect(readStatValue('Requests This Month')).toBe('900');
    });

    await act(async () => {
      staleRefresh.resolve(okResult(staleStats));
      await staleRefresh.promise;
    });

    expect(readStatValue('Requests This Month')).toBe('900');
    expect(readStatValue('Total Requests')).toBe('9,000');
  });

  it('falls back to placeholder history when usage history is missing', async () => {
    mockReadCachedUsageStats.mockReturnValue(
      okResult(
        buildStats({
          usageHistory: [],
        })
      )
    );
    mockRefreshUsageStats.mockResolvedValue(errResult('Unable to refresh usage'));

    const { container } = renderUsagePage();

    await waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith('Failed to refresh usage stats', {
        message: 'Unable to refresh usage',
        status: 500,
      });
    });

    expect(container.querySelectorAll('div.cursor-pointer').length).toBe(30);
    expect(readStatValue('Average Daily')).toBe('11');
  });

  it('logs unexpected refresh failures without crashing render', async () => {
    const refreshError = new Error('network down');
    mockRefreshUsageStats.mockRejectedValue(refreshError);

    renderUsagePage();

    await waitFor(() => {
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected failure while refreshing usage stats',
        { error: refreshError }
      );
    });

    expect(screen.getByText('Consumption History')).toBeInTheDocument();
  });
});
