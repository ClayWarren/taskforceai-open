import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readCachedUsageStats,
  refreshUsageStats as refreshUsageStatsRequest,
  type UsageStats,
} from './developer-dashboard';
import { logger } from '../logger';

type UseDeveloperUsageStatsOptions = {
  isAuthenticated: boolean;
  isAuthLoading?: boolean;
  refreshIntervalMs?: number;
  userScope: string;
};

export const useDeveloperUsageStats = ({
  isAuthenticated,
  isAuthLoading = false,
  refreshIntervalMs,
  userScope,
}: UseDeveloperUsageStatsOptions) => {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const latestRequestIdRef = useRef(0);
  const inFlightRequestIdRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    inFlightRequestIdRef.current = requestId;

    try {
      const result = await refreshUsageStatsRequest();
      if (!mountedRef.current || requestId !== latestRequestIdRef.current) return result;

      if (result.ok) {
        setStats(result.value);
      } else {
        logger.error('Failed to refresh usage stats', {
          message: result.error.message,
          status: result.error.status,
        });
      }
      setLoading(false);
      return result;
    } catch (error) {
      if (mountedRef.current && requestId === latestRequestIdRef.current) {
        logger.error('Unexpected failure while refreshing usage stats', { error });
      }
      throw error;
    } finally {
      if (inFlightRequestIdRef.current === requestId) {
        inFlightRequestIdRef.current = null;
      }
    }
  }, []);

  const refreshInBackground = useCallback(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRequestIdRef.current += 1;
      inFlightRequestIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestRequestIdRef.current += 1;
    inFlightRequestIdRef.current = null;

    if (isAuthLoading) {
      setStats(null);
      setLoading(true);
      return;
    }

    if (!isAuthenticated) {
      setStats(null);
      setLoading(false);
      return;
    }

    setStats(null);
    setLoading(true);
    const cached = readCachedUsageStats();
    if (cached.ok) {
      setStats(cached.value);
      setLoading(false);
    }
    refreshInBackground();
  }, [isAuthenticated, isAuthLoading, refreshInBackground, userScope]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || refreshIntervalMs === undefined) return;

    const refreshWhenIdle = () => {
      if (inFlightRequestIdRef.current === null) refreshInBackground();
    };
    const intervalId = setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshWhenIdle();
    }, refreshIntervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenIdle();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, isAuthLoading, refreshInBackground, refreshIntervalMs, userScope]);

  return { loading, refresh, stats };
};
