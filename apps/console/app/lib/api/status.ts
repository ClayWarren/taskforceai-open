import { z } from 'zod';
import type { DayStatus, ServiceStatus, StatusResponse } from '../../components/status/types';
import { SERVICE_IDS, SERVICE_NAMES } from '../../components/status/types';

import { logger } from '../logger';
import { getServerBaseUrl } from './server-base-url';

const statusResponseSchema = z.object({
  overallStatus: z.enum(['operational', 'degraded', 'maintenance', 'outage']),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['operational', 'degraded', 'maintenance', 'outage']),
      uptimePercent: z.number(),
      uptimeHistory: z.array(
        z.object({
          date: z.string(),
          status: z.enum(['operational', 'degraded', 'maintenance', 'outage']),
          message: z.string().optional(),
        })
      ),
    })
  ),
  lastUpdated: z.string(),
});

export type StatusError = {
  kind: 'server' | 'network';
  message: string;
  status?: number;
};

// Set the date when status tracking began (matches backend)
const STATUS_TRACKING_START_DATE = new Date('2026-01-19');

const generateUptimeHistory = (maxDays: number = 90): DayStatus[] => {
  const history: DayStatus[] = [];
  const today = new Date();

  // Calculate days since we started tracking
  const diffTime = Math.abs(today.getTime() - STATUS_TRACKING_START_DATE.getTime());
  const daysSinceStart = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Use the smaller of: days actually passed OR the 90-day display limit
  const daysToGenerate = Math.min(daysSinceStart, maxDays);

  for (let i = daysToGenerate - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // 99.5% chance of operational for mock fallback
    const rand = Math.random();
    let status: ServiceStatus = 'operational';
    if (rand > 0.995) {
      status = 'degraded';
    }

    history.push({
      date: date.toISOString().split('T')[0] ?? '',
      status,
      message: status === 'operational' ? 'No incidents reported' : `Incident reported: ${status}`,
    });
  }

  return history;
};

const calculateUptimePercent = (history: DayStatus[]): number => {
  if (history.length === 0) return 100;

  const operationalDays = history.filter(
    (day) => day.status === 'operational' || day.status === 'maintenance'
  ).length;

  return Number(((operationalDays / history.length) * 100).toFixed(2));
};

const getMockStatusResponse = (): StatusResponse => {
  const serviceIds = Object.values(SERVICE_IDS);
  const services = serviceIds.map((id) => {
    const uptimeHistory = generateUptimeHistory(90);
    return {
      id,
      name: SERVICE_NAMES[id] ?? id,
      status: 'operational' as ServiceStatus,
      uptimePercent: calculateUptimePercent(uptimeHistory),
      uptimeHistory,
    };
  });

  return {
    overallStatus: 'operational',
    services,
    lastUpdated: new Date().toISOString(),
  };
};

export const fetchStatus = async ({
  baseUrl = getServerBaseUrl(),
  useMock = false,
}: {
  baseUrl?: string;
  useMock?: boolean;
} = {}): Promise<StatusResponse> => {
  if (useMock) {
    return getMockStatusResponse();
  }

  try {
    // Public GET requests usually don't need CSRF, but if the endpoint is wrapped in WithCSRF
    // we need to provide the token. Since WithCSRF in security.go exempts GET, this is safe.
    const response = await fetch(`${baseUrl}/api/v1/status`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch status: ${response.status}`);
    }

    const raw = await response.json();
    const parsed = statusResponseSchema.safeParse(raw);

    if (!parsed.success) {
      logger.error('Invalid status response format', { issues: parsed.error.issues });
      throw new Error('Invalid status response format');
    }

    return parsed.data as StatusResponse;
  } catch (error) {
    if (useMock) return getMockStatusResponse();

    logger.error('Fetch status failed', { error });
    const serviceIds = Object.values(SERVICE_IDS);
    return {
      overallStatus: 'outage',
      lastUpdated: new Date().toISOString(),
      services: serviceIds.map((id) => ({
        id: id as string,
        name: SERVICE_NAMES[id as keyof typeof SERVICE_NAMES] ?? id,
        status: 'outage',
        uptimePercent: 0,
        uptimeHistory: [],
      })),
    };
  }
};
