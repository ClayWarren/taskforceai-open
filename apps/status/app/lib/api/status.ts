import { z } from 'zod';
import type { StatusResponse } from '@taskforceai/contracts/api/status';
import { logger } from '../logger';
import { statusMetrics } from '../observability/metrics';

/**
 * The Source of Truth for system status.
 * In a real outage, the API might be down, so we fetch a static JSON file
 * pushed by our backend to a highly-available storage (Vercel Blob).
 */
const rawUrl = import.meta.env['VITE_STATUS_JSON_URL'];
const DEFAULT_STATUS_JSON_URL = '/status.json';

export function resolveStatusJsonUrl(url: string | undefined): string {
  const candidate = url?.trim();
  if (!candidate) {
    return DEFAULT_STATUS_JSON_URL;
  }

  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return candidate;
    }
  } catch {
    // Ignore parse errors and fall through to default.
  }

  return DEFAULT_STATUS_JSON_URL;
}

const STATUS_JSON_URL = resolveStatusJsonUrl(rawUrl);

const FETCH_TIMEOUT_MS = 10000;
const MAX_STATUS_AGE_MS = 5 * 60 * 1000;
const MAX_STATUS_FUTURE_SKEW_MS = 60 * 1000;
const JSON_CONTENT_TYPE = 'application/json';

export type StatusError = {
  kind: 'server' | 'network';
  message: string;
  status?: number;
};

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === JSON_CONTENT_TYPE || mediaType.endsWith('+json');
}

// ---------------------------------------------------------------------------
// Response schema — validates the blob/API shape at the boundary so malformed
// data throws here rather than crashing deep inside a render.
// ---------------------------------------------------------------------------
const serviceStatusSchema = z.enum(['operational', 'degraded', 'outage', 'maintenance']);

const statusResponseSchema = z.object({
  overallStatus: serviceStatusSchema,
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: serviceStatusSchema,
      uptimePercent: z.number(),
      uptimeHistory: z.array(
        z.object({
          date: z.string(),
          status: serviceStatusSchema,
          message: z.string().optional(),
        })
      ),
    })
  ),
  incidents: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: serviceStatusSchema,
        affectedServices: z.array(z.string()),
        updates: z.array(
          z.object({
            id: z.string(),
            status: serviceStatusSchema,
            message: z.string(),
            createdAt: z.string(),
          })
        ),
        createdAt: z.string(),
        resolvedAt: z.string().optional(),
      })
    )
    .optional(),
  lastUpdated: z.string(),
});

class StaleStatusSnapshotError extends Error {
  constructor(lastUpdated: string) {
    super(`Status snapshot is stale or has an invalid lastUpdated value: ${lastUpdated}`);
    this.name = 'StaleStatusSnapshotError';
  }
}

export function isStatusSnapshotFresh(lastUpdated: string, nowMs = Date.now()): boolean {
  const lastUpdatedMs = Date.parse(lastUpdated);
  if (!Number.isFinite(lastUpdatedMs)) {
    return false;
  }

  const ageMs = nowMs - lastUpdatedMs;
  return ageMs >= -MAX_STATUS_FUTURE_SKEW_MS && ageMs <= MAX_STATUS_AGE_MS;
}

async function fetchValidatedStatus(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<StatusResponse> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type');
  if (!isJsonContentType(contentType)) {
    throw new Error(`Expected JSON response but received ${contentType}`);
  }

  return statusResponseSchema.parse(await response.json());
}

async function fetchObservedStatus(
  source: 'static' | 'api',
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<StatusResponse> {
  const tags = { source };
  statusMetrics.incrementCounter('status.fetch.total', tags);
  const stopTimer = statusMetrics.startTimer('status.fetch.duration', tags);
  try {
    const status = await fetchValidatedStatus(url, init, errorPrefix);
    if (!isStatusSnapshotFresh(status.lastUpdated)) {
      throw new StaleStatusSnapshotError(status.lastUpdated);
    }
    statusMetrics.incrementCounter('status.fetch.success', tags);
    return status;
  } catch (error) {
    statusMetrics.incrementCounter('status.fetch.failure', {
      ...tags,
      error: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  } finally {
    stopTimer();
  }
}

/**
 * Returns an AbortSignal that fires after `ms` milliseconds, optionally
 * also firing when `external` is aborted. Returns a cleanup function that
 * must be called to clear the timeout once the fetch completes.
 */
export function timedSignal(
  ms: number,
  external?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);

  const onExternalAbort = () => controller.abort();
  if (external?.aborted) {
    controller.abort();
  } else {
    external?.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(id);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * Fetches system status with a two-tier fallback:
 *   1. Vercel Blob static file (highly available, survives API outages)
 *   2. Live API endpoint
 *
 * Both sources have a 5s timeout. Responses are validated against the
 * expected schema — malformed data falls through to the next source.
 *
 * Accepts an optional AbortSignal so callers can cancel in-flight requests
 * (e.g. when a newer refresh fires before the previous one completes).
 *
 * Returns null if both sources fail — callers must treat null as
 * "status unknown", never as "all operational".
 */
export const fetchStatus = async (externalSignal?: AbortSignal): Promise<StatusResponse | null> => {
  if (externalSignal?.aborted) {
    statusMetrics.incrementCounter('status.fetch.skipped', { reason: 'aborted' });
    return null;
  }

  try {
    const { signal, cleanup } = timedSignal(FETCH_TIMEOUT_MS, externalSignal);
    try {
      return await fetchObservedStatus(
        'static',
        STATUS_JSON_URL,
        { cache: 'no-store', signal },
        'Failed to fetch status.json'
      );
    } finally {
      cleanup();
    }
  } catch (primaryError) {
    if (externalSignal?.aborted) return null;
    logger.warn('Static status source unavailable; falling back to API', { error: primaryError });

    // Fallback: try the live API endpoint (also with a 5s timeout)
    let fallbackError: unknown;
    try {
      const { signal, cleanup } = timedSignal(FETCH_TIMEOUT_MS, externalSignal);
      try {
        return await fetchObservedStatus(
          'api',
          '/api/v1/status',
          { cache: 'no-store', signal },
          'API fallback returned'
        );
      } finally {
        cleanup();
      }
    } catch (e) {
      fallbackError = e;
    }

    if (externalSignal?.aborted) return null;

    // Both sources failed — fire an error event so Sentry is alerted, then return null.
    // Callers must never interpret null as "operational"; show an honest error state instead.
    logger.error('All status sources unavailable; status unknown', {
      primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
      fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });
    statusMetrics.incrementCounter('status.fetch.unavailable');
    return null;
  }
};
