import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';

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
  createFileRoute: () => (options: unknown) => options,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode;
    to: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} data-router-link="true" {...props}>
      {children}
    </a>
  ),
}));

import { FeatureCard, Route } from './index';
import { KeyRound } from 'lucide-react';

const buildStats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totalRequests: 5_500,
  requestsThisMonth: 1_200,
  requestsThisWeek: 230,
  requestsToday: 42,
  monthlyQuota: 10_000,
  monthlyRemaining: 8_800,
  periodStart: '2026-02-01T00:00:00.000Z',
  periodEnd: '2026-02-28T23:59:59.000Z',
  apiKeys: [
    {
      keyId: 1,
      displayKey: 'tfai_live_aaaa',
      tier: 'pro',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-02-11T00:00:00.000Z',
      revokedAt: null,
      hourlyLimit: 500,
      monthlyQuota: 50_000,
      currentHourlyUsage: 10,
      dailyUsage: 100,
      weeklyUsage: 500,
      monthlyUsage: 1_200,
    },
    {
      keyId: 2,
      displayKey: 'tfai_live_bbbb',
      tier: 'pro',
      createdAt: '2026-01-12T00:00:00.000Z',
      lastUsedAt: '2026-02-10T00:00:00.000Z',
      revokedAt: null,
      hourlyLimit: 500,
      monthlyQuota: 50_000,
      currentHourlyUsage: 6,
      dailyUsage: 80,
      weeklyUsage: 350,
      monthlyUsage: 900,
    },
    {
      keyId: 3,
      displayKey: 'tfai_live_cccc',
      tier: 'free',
      createdAt: '2025-12-01T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: '2026-02-01T00:00:00.000Z',
      hourlyLimit: 100,
      monthlyQuota: 10_000,
      currentHourlyUsage: 0,
      dailyUsage: 0,
      weeklyUsage: 0,
      monthlyUsage: 0,
    },
  ],
  usageHistory: [
    { date: '2026-02-10T00:00:00.000Z', count: 12 },
    { date: '2026-02-11T00:00:00.000Z', count: 15 },
    { date: '2026-02-12T00:00:00.000Z', count: 18 },
  ],
  ...overrides,
});

const readSummaryValue = (label: string) => {
  const labelElement = screen.getByText(label);
  const parent = labelElement.parentElement;
  if (!parent) {
    return '';
  }
  const valueElement = parent.querySelectorAll('span')[1];
  return valueElement?.textContent ?? '';
};

const getOverviewPageComponent = (): ComponentType => {
  const route = Route as unknown as {
    component?: ComponentType;
    options?: { component?: ComponentType };
  };
  const OverviewPage = route.options?.component ?? route.component;
  if (!OverviewPage) {
    throw new Error('index route component is unavailable');
  }
  return OverviewPage;
};

const renderOverviewPage = () => {
  const OverviewPage = getOverviewPageComponent();
  return render(<OverviewPage />);
};

describe('console index route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignInUrl.mockReturnValue('https://auth.taskforce.test/sign-in');
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: { full_name: 'Clay Warren' },
    });
    mockUseDeveloperUsageStats.mockReturnValue({ stats: buildStats() });
  });

  it('renders unauthenticated placeholder and starts sign-in flow', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      user: null,
    });

    renderOverviewPage();

    expect(screen.getByText('TaskForceAI Developer Console')).toBeInTheDocument();
    expect(screen.getByText('Sign in to view your real-time stats')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to your account' }));

    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: expect.any(String),
    });
  });

  it('renders overview metrics from shared stats state', async () => {
    renderOverviewPage();

    expect(await screen.findByText('Welcome, Clay')).toBeInTheDocument();
    expect(readSummaryValue('API Keys active')).toBe('2');
    expect(readSummaryValue('Total requests (lifetime)')).toBe('5,500');
  });

  it('starts sign-in flow from the unauthenticated overlay call-to-action', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      user: null,
    });

    renderOverviewPage();

    fireEvent.click(screen.getByRole('button', { name: 'Get started →' }));

    expect(mockGetSignInUrl).toHaveBeenCalledWith({
      callbackUrl: expect.any(String),
    });
  });

  it('shows monthly request activity and falls back to placeholder chart bars', async () => {
    mockUseDeveloperUsageStats.mockReturnValue({
      stats: buildStats({
        requestsThisMonth: 20_000,
        monthlyQuota: 10_000,
        monthlyRemaining: 0,
        usageHistory: [],
      }),
    });

    const { container } = renderOverviewPage();

    expect(await screen.findByText('20,000')).toBeInTheDocument();
    expect(container.querySelectorAll('div.rounded-sm.transition-all.duration-500').length).toBe(
      30
    );
  });

  it('renders safe zero defaults when usage stats are unavailable', async () => {
    mockUseDeveloperUsageStats.mockReturnValue({ stats: null });

    renderOverviewPage();

    expect(await screen.findByText('Welcome, Clay')).toBeInTheDocument();
    expect(readSummaryValue('Total requests (lifetime)')).toBe('0');
    expect(readSummaryValue('API Keys active')).toBe('0');
  });

  it('renders external href feature cards with safe link attributes', () => {
    render(
      <FeatureCard
        href="https://docs.taskforceai.chat"
        isExternal
        title="Read the docs"
        description="Integration guides and API reference"
        icon={KeyRound}
      />
    );

    const link = screen.getByRole('link', { name: /Read the docs/i });
    expect(link).toHaveAttribute('href', 'https://docs.taskforceai.chat');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
