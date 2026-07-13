import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ComponentType } from 'react';

import '../../../../tests/setup/dom';

import type { UsageStats } from '../lib/developer/developer-dashboard';

const mockUseAuth = vi.fn();
const mockGetSignInUrl = vi.fn();
const mockUseDeveloperUsageStats = vi.fn();

vi.mock('@taskforceai/ui-kit/auth/AuthProvider', () => ({
  useAuth: mockUseAuth,
}));

vi.mock('@taskforceai/api-client/auth/auth-client', () => ({
  authClient: {
    getSignInUrl: mockGetSignInUrl,
  },
}));

vi.mock('../lib/developer/useDeveloperUsageStats', () => ({
  useDeveloperUsageStats: mockUseDeveloperUsageStats,
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
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
    mockUseDeveloperUsageStats.mockReturnValue({ stats: buildStats() });
    window.location.href = 'http://localhost/';
  });

  it('renders sign-in gate for unauthenticated users', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });

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

  it('shows a loading state while authentication is bootstrapping', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });

    renderUsagePage();

    expect(screen.getByText('Loading usage metrics')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in to continue' })).not.toBeInTheDocument();
    expect(mockUseDeveloperUsageStats).toHaveBeenCalledWith({
      isAuthenticated: false,
      isAuthLoading: true,
      refreshIntervalMs: 30_000,
    });
  });

  it('renders usage summary and history from shared stats state', () => {
    const { container } = renderUsagePage();

    expect(readStatValue('Requests This Month')).toBe('300');
    expect(readStatValue('Total Requests')).toBe('5,000');
    expect(container.querySelectorAll('div.cursor-pointer')).toHaveLength(3);
    expect(screen.getByText('Refreshes automatically')).toBeInTheDocument();
  });

  it('falls back to placeholder history when usage history is missing', () => {
    mockUseDeveloperUsageStats.mockReturnValue({ stats: buildStats({ usageHistory: [] }) });

    const { container } = renderUsagePage();

    expect(container.querySelectorAll('div.cursor-pointer')).toHaveLength(30);
    expect(readStatValue('Average Daily')).toBe('11');
  });
});
