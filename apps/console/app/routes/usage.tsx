import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, LogIn, TrendingUp } from 'lucide-react';
import { useEffect, useState, useMemo, useRef } from 'react';

import { logger } from '../lib/logger';
import { useAuth } from '@taskforceai/ui-kit/auth/AuthProvider';
import {
  refreshUsageStats,
  readCachedUsageStats,
  type UsageStats,
} from '../lib/developer/developer-dashboard';
import { Button } from '@taskforceai/ui-kit/button';
import { getConsoleSignInUrl } from '../lib/auth/sign-in';
import { averageDailyRequests } from '../lib/usage/usage-metrics';
import { AuthLoadingState } from '../components/auth/AuthLoadingState';

export const Route = createFileRoute('/usage')({
  component: UsagePage,
});

export const USAGE_REFRESH_INTERVAL_MS = 30_000;

function UsagePage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const refreshRequestIdRef = useRef(0);
  const placeholderHistory = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - index));
      return { count: 0, date: date.toISOString() };
    });
  }, []);

  useEffect(() => {
    if (isAuthLoading) {
      return;
    }

    if (!isAuthenticated) {
      refreshRequestIdRef.current += 1;
      setStats(null);
      return;
    }

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    let isCurrent = true;
    let isRefreshing = false;

    const cached = readCachedUsageStats();
    if (cached.ok) setStats(cached.value);

    const loadUsageStats = async () => {
      if (isRefreshing) return;
      isRefreshing = true;
      try {
        const result = await refreshUsageStats();
        if (!isCurrent || requestId !== refreshRequestIdRef.current) return;
        if (result.ok) {
          setStats(result.value);
          return;
        }
        logger.error('Failed to refresh usage stats', {
          message: result.error.message,
          status: result.error.status,
        });
      } catch (error) {
        if (!isCurrent || requestId !== refreshRequestIdRef.current) return;
        logger.error('Unexpected failure while refreshing usage stats', {
          error,
        });
      } finally {
        isRefreshing = false;
      }
    };
    void loadUsageStats();

    const refreshInterval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void loadUsageStats();
      }
    }, USAGE_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadUsageStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCurrent = false;
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, isAuthLoading]);

  const history = useMemo(() => {
    if (stats?.usageHistory?.length) {
      return stats.usageHistory;
    }
    return placeholderHistory;
  }, [stats, placeholderHistory]);

  const maxCount = useMemo(() => {
    if (!history || history.length === 0) return 100;
    const counts = history.map((h) => h.count);
    return Math.max(...counts, 10);
  }, [history]);

  const lastHistoryItem = history.length > 0 ? history[history.length - 1] : undefined;
  const startDate =
    history.length > 0 && history[0]?.date
      ? new Date(history[0].date).toLocaleDateString()
      : 'Start';
  const endDate = lastHistoryItem?.date
    ? new Date(lastHistoryItem.date).toLocaleDateString()
    : 'End';

  if (isAuthLoading) {
    return <AuthLoadingState label="Loading usage metrics" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center duration-500 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/10">
          <BarChart3 className="h-10 w-10 text-blue-500" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-3xl font-bold text-white">Usage Metrics</h1>
          <p className="text-slate-400">
            Sign in to track your API consumption, monitor spending, and view detailed usage
            history.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => (window.location.href = getConsoleSignInUrl(window.location.href))}
          className="gap-2 bg-blue-600 hover:bg-blue-500"
        >
          <LogIn className="h-4 w-4" />
          Sign in to continue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-12 duration-500 animate-in fade-in">
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Usage</h1>
        <p className="mt-2 text-slate-400">Monitor your API consumption and spending</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            <h3 className="text-lg font-bold text-white">Consumption History</h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <TrendingUp className="h-3 w-3" />
            <span>Refreshes automatically</span>
          </div>
        </div>

        {/* Detailed Chart */}
        <div className="flex h-64 items-end justify-between gap-1">
          {history.map((item, i) => {
            const height = (item.count / maxCount) * 100;
            return (
              <div
                key={i}
                className="group relative w-full cursor-pointer rounded-t-sm bg-white/10 transition-all hover:bg-blue-600/50"
                style={{ height: `${Math.max(height, 2)}%` }}
              >
                <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded border border-white/10 bg-slate-800 px-2 py-1 text-[10px] whitespace-nowrap text-white opacity-0 group-hover:opacity-100">
                  {item.date ? new Date(item.date).toLocaleDateString() : 'No data'}: {item.count}{' '}
                  reqs
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between text-[10px] font-bold tracking-widest text-slate-500 uppercase">
          <span>{startDate}</span>
          <span>{endDate}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <StatItem label="Total Requests" value={stats?.totalRequests?.toLocaleString() ?? '0'} />
        <StatItem
          label="Requests This Month"
          value={stats?.requestsThisMonth?.toLocaleString() ?? '0'}
        />
        <StatItem
          label="Average Daily"
          value={
            stats
              ? averageDailyRequests({
                  requestsThisMonth: stats.requestsThisMonth,
                  periodStart: stats.periodStart,
                  periodEnd: stats.periodEnd,
                }).toLocaleString()
              : '0'
          }
        />
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
