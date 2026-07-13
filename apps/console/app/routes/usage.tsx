import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';

import { useAuth } from '@taskforceai/ui-kit/auth/AuthProvider';
import { useDeveloperUsageStats } from '../lib/developer/useDeveloperUsageStats';
import { averageDailyRequests } from '../lib/usage/usage-metrics';
import { AuthLoadingState } from '../components/auth/AuthLoadingState';
import { AuthSignInGate } from '../components/auth/AuthSignInGate';

export const Route = createFileRoute('/usage')({
  component: UsagePage,
});

export const USAGE_REFRESH_INTERVAL_MS = 30_000;

function UsagePage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { stats } = useDeveloperUsageStats({
    isAuthenticated,
    isAuthLoading,
    refreshIntervalMs: USAGE_REFRESH_INTERVAL_MS,
  });
  const placeholderHistory = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - index));
      return { count: 0, date: date.toISOString() };
    });
  }, []);

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
      <AuthSignInGate
        icon={BarChart3}
        title="Usage Metrics"
        description="Sign in to track your API consumption, monitor spending, and view detailed usage history."
      />
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
