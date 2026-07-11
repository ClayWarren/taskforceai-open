import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, KeyRound, BarChart3, Zap, TrendingUp, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@taskforceai/ui-kit/auth/AuthProvider';
import {
  refreshUsageStats,
  readCachedUsageStats,
  type UsageStats,
} from '../lib/developer/developer-dashboard';
import { cn } from '@taskforceai/ui-kit/utils';
import { Button } from '@taskforceai/ui-kit/button';
import { getConsoleSignInUrl } from '../lib/auth/sign-in';
import { averageDailyRequests } from '../lib/usage/usage-metrics';

export const Route = createFileRoute('/')({
  component: OverviewPage,
});

const PLACEHOLDER_USAGE_HISTORY = Array.from({ length: 30 }, () => ({
  date: undefined,
  count: 0,
}));

const overviewMetrics = (stats: UsageStats | null, isAuthenticated: boolean) => {
  const visibleStats = isAuthenticated ? stats : null;
  const usageHistory = visibleStats?.usageHistory ?? [];
  const hasUsageHistory = usageHistory.length > 0;
  const activityHistory = hasUsageHistory ? usageHistory : PLACEHOLDER_USAGE_HISTORY;
  return {
    visibleStats,
    usageHistory,
    hasUsageHistory,
    activityHistory,
    activityMaxCount: Math.max(...activityHistory.map((day) => day.count), 1),
    usagePercent: visibleStats
      ? Math.min(
          (visibleStats.requestsThisMonth / Math.max(visibleStats.monthlyQuota, 1)) * 100,
          100
        )
      : 0,
    requestsLabel: visibleStats?.requestsThisMonth?.toLocaleString() ?? '0',
    remainingLabel: visibleStats?.monthlyRemaining?.toLocaleString() ?? '0',
    dailyAverageLabel: visibleStats
      ? averageDailyRequests({
          requestsThisMonth: visibleStats.requestsThisMonth,
          periodStart: visibleStats.periodStart,
          periodEnd: visibleStats.periodEnd,
        }).toLocaleString()
      : '0',
    totalRequestsLabel: visibleStats?.totalRequests?.toLocaleString() ?? '0',
    activeApiKeyCount: visibleStats?.apiKeys?.filter((key) => !key.revokedAt).length ?? 0,
    reportingPeriodCount: usageHistory.length,
  };
};

function OverviewPage() {
  const { user, isAuthenticated } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const refreshRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) {
      refreshRequestIdRef.current += 1;
      setStats(null);
      return;
    }

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    let isCurrent = true;

    const cached = readCachedUsageStats();
    if (cached.ok) setStats(cached.value);

    void refreshUsageStats().then((result) => {
      if (!isCurrent || requestId !== refreshRequestIdRef.current) return;
      if (result.ok) setStats(result.value);
    });

    return () => {
      isCurrent = false;
    };
  }, [isAuthenticated]);

  const {
    visibleStats,
    usageHistory,
    hasUsageHistory,
    activityHistory,
    activityMaxCount,
    usagePercent,
    requestsLabel,
    remainingLabel,
    dailyAverageLabel,
    totalRequestsLabel,
    activeApiKeyCount,
    reportingPeriodCount,
  } = overviewMetrics(stats, isAuthenticated);

  const handleSignIn = () => {
    window.location.href = getConsoleSignInUrl(window.location.href);
  };

  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-12 duration-500 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            {isAuthenticated
              ? `Welcome, ${user?.full_name?.split(' ')[0] ?? 'Developer'}`
              : 'TaskForceAI Developer Console'}
          </h1>
          <p className="mt-2 text-slate-400">
            {isAuthenticated
              ? 'Account overview and usage statistics'
              : 'The central hub for managing your TaskForceAI integration, API keys, and monitoring usage.'}
          </p>
        </div>
        {!isAuthenticated && (
          <Button size="lg" onClick={handleSignIn} className="bg-blue-600 hover:bg-blue-500">
            Sign in to your account
          </Button>
        )}
      </div>

      {/* Hero Stats (Conditional Blur for Unauthenticated) */}
      <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-2">
        {!isAuthenticated && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-[2px]">
            <div className="text-center">
              <p className="text-sm font-bold text-white">Sign in to view your real-time stats</p>
              <Button variant="link" onClick={handleSignIn} className="mt-2 text-blue-400">
                Get started →
              </Button>
            </div>
          </div>
        )}
        {/* Usage Ring Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-wider text-slate-400 uppercase">
              Usage Snapshot for {currentMonth}
            </h2>
            {visibleStats?.periodEnd && (
              <span className="text-[10px] text-slate-400">
                Period ends {new Date(visibleStats.periodEnd).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="mt-8 flex items-center gap-12">
            <div className="relative h-32 w-32 shrink-0">
              {/* SVG Ring */}
              <svg className="h-full w-full" viewBox="0 0 100 100">
                <circle
                  className="text-white/5"
                  strokeWidth="8"
                  stroke="currentColor"
                  fill="transparent"
                  r="42"
                  cx="50"
                  cy="50"
                />
                <circle
                  className="text-blue-600 transition-all duration-1000 ease-in-out"
                  strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={2 * Math.PI * 42 * (1 - usagePercent / 100)}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                  r="42"
                  cx="50"
                  cy="50"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(usagePercent)}%</span>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  Requests
                </p>
                <p className="mt-1 text-sm font-bold text-white">{requestsLabel}</p>
                <p className="text-[10px] text-slate-400">This month</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  Remaining
                </p>
                <p className="mt-1 text-sm font-bold text-white">{remainingLabel}</p>
                <p className="text-[10px] text-slate-400">Until reset</p>
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  Daily Avg
                </p>
                <p className="mt-1 text-sm font-bold text-white">{dailyAverageLabel}</p>
                <p className="text-[10px] text-slate-400">Requests / day</p>
              </div>
            </div>
          </div>

          <div className="mt-12 flex items-center justify-between border-t border-white/5 pt-6 text-xs">
            <span className="text-slate-400">Total requests (lifetime)</span>
            <span className="font-mono font-bold text-white">{totalRequestsLabel}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-400">API Keys active</span>
            <span className="font-mono font-bold text-white">{activeApiKeyCount}</span>
          </div>
        </div>

        {/* Activity Chart Card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-wider text-slate-400 uppercase">
              Activity History
            </h2>
            <div className="flex items-center gap-2 text-xs text-blue-400">
              <TrendingUp className="h-3 w-3" />
              <span>Usage trend</span>
            </div>
          </div>

          <div className="mt-8 flex h-32 items-end justify-between gap-2">
            {activityHistory.map((day, i) => {
              const height = hasUsageHistory ? (day.count / activityMaxCount) * 100 : 10;
              return (
                <div
                  key={i}
                  className={cn(
                    'w-full rounded-sm transition-all duration-500',
                    hasUsageHistory && i === usageHistory.length - 1 ? 'bg-blue-600' : 'bg-white/10'
                  )}
                  style={{ height: `${Math.max(height, 5)}%` }}
                  title={day.date ? `${day.date}: ${day.count} requests` : undefined}
                />
              );
            })}
          </div>

          <div className="mt-12 flex flex-col gap-1 border-t border-white/5 pt-6">
            <p className="text-sm font-bold text-white">Consumption patterns</p>
            <p className="text-xs text-slate-400">
              Showing usage for the last{' '}
              <span className="font-bold text-slate-300">{reportingPeriodCount}</span> reporting
              periods
            </p>
          </div>
        </div>
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          to="/api-keys"
          title="Create an API key"
          description="Start integrating with our API"
          icon={KeyRound}
        />
        <FeatureCard
          to="/usage"
          title="Track your usage"
          description="Deep dive into your usage"
          icon={BarChart3}
        />
        <FeatureCard
          to="/models"
          title="View models"
          description="Compare models and costs"
          icon={Zap}
        />
      </div>
    </div>
  );
}

interface FeatureCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  to?: string;
  href?: string;
  isExternal?: boolean;
}

export function FeatureCard({
  title,
  description,
  icon: Icon,
  to,
  href,
  isExternal,
}: FeatureCardProps) {
  const content = (
    <div className="group relative flex h-full flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-white/20 hover:bg-white/[0.05]">
      <div>
        <Icon className="h-6 w-6 text-white" />
        <h2 className="mt-6 text-sm font-bold text-white">{title}</h2>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      <div className="mt-8 flex justify-end">
        <ArrowUpRight className="h-4 w-4 text-slate-600 transition-colors group-hover:text-white" />
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
      >
        {content}
      </a>
    );
  }

  return <Link to={to ?? '/'}>{content}</Link>;
}
