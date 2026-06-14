import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

import { fetchStatus } from '../../lib/api/status';
import { TooltipProvider } from '../ui/tooltip';
import { ServiceStatusCard } from './ServiceStatusCard';
import { StatusBanner } from './StatusBanner';
import { IncidentHistory } from './IncidentHistory';
import { StatusHeader } from './BrandMark';
import type { StatusResponse } from './types';
import { parseStatusDate } from './date-utils';

const REFRESH_INTERVAL = 60000; // 60 seconds

function formatTimeAgo(dateString: string): string {
  const date = parseStatusDate(dateString);
  if (!date) {
    return 'unknown';
  }

  return formatDistanceToNow(date, { addSuffix: true });
}

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const data = await fetchStatus(controller.signal);

    // Discard the result if this request was superseded or the component unmounted
    if (controller.signal.aborted) return;

    if (data) {
      setStatus(data);
    }
    setFetchFailed(data === null);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Auto-refresh every 60 seconds, paused while the tab is hidden
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      interval = setInterval(() => void loadStatus(), REFRESH_INTERVAL);
    };

    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        // Refresh immediately on tab focus so stale data isn't shown, then resume polling
        void loadStatus();
        start();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stop();
    };
  }, [loadStatus]);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Update "last updated" display every 10 seconds
  useEffect(() => {
    if (!status) return;

    const updateDisplay = () => {
      setLastUpdatedDisplay(formatTimeAgo(status.lastUpdated));
    };

    updateDisplay();
    const interval = setInterval(updateDisplay, 10000);
    return () => clearInterval(interval);
  }, [status]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="animate-pulse">
          <div className="mb-8 h-16 rounded-lg bg-muted" />
          <div className="mb-6 h-6 w-48 rounded bg-muted" />
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen bg-background">
        <StatusHeader />
        <main className="mx-auto max-w-4xl px-4 py-12">
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="mb-2 text-lg font-semibold text-foreground">Status unavailable</p>
            <p className="mb-6 max-w-md text-sm text-muted-foreground">
              Unable to reach our status endpoints. This may indicate a widespread outage. Check{' '}
              <a
                href="https://x.com/taskforceai_us"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-foreground"
              >
                @taskforceai_us
              </a>{' '}
              for updates.
            </p>
            <button
              onClick={() => {
                setLoading(true);
                void loadStatus();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Get max history length from services to show in title
  const historyDays = status.services.reduce((max, s) => Math.max(max, s.uptimeHistory.length), 0);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-screen bg-background">
        <StatusHeader />

        <main className="mx-auto max-w-4xl px-4 py-12">
          <h1 className="mb-8 text-3xl font-bold">System Status</h1>

          <div className="mb-8">
            <StatusBanner status={status.overallStatus} />
          </div>
          {fetchFailed ? (
            <p className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-900 dark:text-yellow-200">
              Live refresh failed. Displaying the last known status snapshot.
            </p>
          ) : null}

          <h2 className="mb-6 text-xl font-semibold text-muted-foreground">
            Uptime (Up to {historyDays} days)
          </h2>

          <div className="space-y-4">
            {status.services.map((service) => (
              <ServiceStatusCard key={service.id} service={service} />
            ))}
          </div>

          <IncidentHistory incidents={status.incidents ?? []} />

          <div className="mt-12 flex items-center justify-between border-t border-border pt-8 text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} TaskForceAI. All rights reserved.</p>
            <p>Last updated {lastUpdatedDisplay}</p>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
