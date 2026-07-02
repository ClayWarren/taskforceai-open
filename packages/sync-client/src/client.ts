import { z } from 'zod';

import { SYNC_PULL_SAFE_ITEM_LIMIT } from '@taskforceai/shared/sync/limits';
import { definedProps } from '@taskforceai/shared/utils/object';

import { getSyncLogger } from './logger';
import { noopSyncMetrics, type SyncMetricsCollector } from './metrics';
import { createRealtimeConnection } from './realtime';
import type {
  BroadcastEvent,
  ConversationSyncPayload,
  DeletionRecord,
  MessageSyncPayload,
  SyncPullResponse,
  SyncPushResponse,
  UnauthorizedSource,
} from './types';
import {
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  SyncStatusResponseSchema,
} from './validation';

export type { SyncMetricsCollector } from './metrics';

type SyncStatusSnapshot = { last_synced_at: string; sync_version: number; pending_changes: number };

export interface HttpSyncClientOptions {
  onUnauthorized?: (c: { source: UnauthorizedSource }) => void;
  getCsrfToken?: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  metrics?: SyncMetricsCollector;
  resilience?: {
    timeoutMs?: number;
    retryAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
  };
}

export interface SyncRequestOptions {
  signal?: AbortSignal;
}

export interface SyncClient {
  pull(v: number, d: string, o?: SyncRequestOptions): Promise<SyncPullResponse>;
  push(
    c: ConversationSyncPayload[],
    m: MessageSyncPayload[],
    d: DeletionRecord[],
    id: string,
    o?: SyncRequestOptions
  ): Promise<SyncPushResponse>;
  getStatus(o?: SyncRequestOptions): Promise<SyncStatusSnapshot>;
  connectRealtime(on: (e: BroadcastEvent) => void): () => void;
}

class SyncHttpError extends Error {
  constructor(
    m: string,
    public readonly status: number
  ) {
    super(m);
    this.name = 'SyncHttpError';
  }
}

class SyncParseError extends Error {
  constructor(
    m: string,
    public override readonly cause: unknown
  ) {
    super(m);
    this.name = 'SyncParseError';
  }
}
const SYNC_FAILURE_LOGGED = Symbol('syncFailureLogged');
type LoggedSyncError = Error & { [SYNC_FAILURE_LOGGED]?: true };

const markSyncFailureLogged = (error: unknown): void => {
  if (error instanceof Error) {
    (error as LoggedSyncError)[SYNC_FAILURE_LOGGED] = true;
  }
};

const wasSyncFailureLogged = (error: unknown): boolean =>
  error instanceof Error && (error as LoggedSyncError)[SYNC_FAILURE_LOGGED] === true;

const parse = async <T>(endpoint: string, response: Response, schema: z.ZodTypeAny): Promise<T> => {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new SyncParseError(`Sync ${endpoint} response parsing failed`, error);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SyncParseError(`Sync ${endpoint} response parsing failed`, parsed.error);
  }

  return parsed.data as T;
};
const DEFAULT_PULL_LIMIT = SYNC_PULL_SAFE_ITEM_LIMIT;
const isUnauthorizedStatus = (status: number): boolean => status === 401 || status === 403;
const normalizeSyncVersion = (version: number): number => {
  if (!Number.isFinite(version)) {
    return 0;
  }
  const normalized = Math.trunc(version);
  const maxInt32 = 2_147_483_647;
  if (normalized > maxInt32) {
    return maxInt32;
  }
  return normalized < 0 ? 0 : normalized;
};

const normalizeDeviceID = (deviceID: string): string => {
  const trimmed = deviceID.trim();
  return trimmed === '' ? 'web-fallback-device' : trimmed;
};

const canUseStaleFallback = (error: unknown): boolean => {
  if (error instanceof SyncParseError) {
    return false;
  }
  return !(error instanceof SyncHttpError) || !isUnauthorizedStatus(error.status);
};

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted', 'AbortError');
  }
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    const abortHandler = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
  });

export function createHttpSyncClient(
  baseUrl: string,
  getToken: () => string | null | Promise<string | null>,
  opts: HttpSyncClientOptions = {}
): SyncClient {
  const logger = getSyncLogger();
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const metrics = opts.metrics ?? noopSyncMetrics;
  const creds = 'include';
  const timeoutMs = Math.max(1000, opts.resilience?.timeoutMs ?? 30000);
  const retryAttempts = Math.max(1, opts.resilience?.retryAttempts ?? 3);
  const baseDelayMs = Math.max(10, opts.resilience?.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, opts.resilience?.maxDelayMs ?? 2000);
  const jitterMs = Math.max(0, opts.resilience?.jitterMs ?? 100);
  let stalePullCache: SyncPullResponse | null = null;
  let staleStatusCache: SyncStatusSnapshot | null = null;

  const logFinalSyncFailure = (metadata: Record<string, unknown>) => {
    const status = typeof metadata['status'] === 'number' ? metadata['status'] : undefined;
    const message = 'Sync request failed without retry or fallback';
    if (status !== undefined && status < 500) {
      logger.warn(message, metadata);
      return;
    }
    logger.error(message, metadata);
  };

  const buildH = async (json = false) => {
    const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {},
      t = await getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  };
  const req = async <T>(
    p: string,
    i: RequestInit,
    s: z.ZodTypeAny,
    src?: UnauthorizedSource
  ): Promise<T> => {
    const staleFallback = (): T | null => {
      if (src === 'pull' && stalePullCache) {
        return stalePullCache as T;
      }
      if (src === 'status' && staleStatusCache) {
        return staleStatusCache as T;
      }
      return null;
    };

    const method = (i.method ?? 'GET').toUpperCase();
    const headers = new Headers(i.headers);
    const metricLabels = {
      endpoint: p,
      method,
      source: src ?? 'unknown',
    };
    metrics.incrementCounter('sync.client.request.total', metricLabels);

    // Apply CSRF token for state-changing methods
    if (
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) &&
      typeof opts.getCsrfToken === 'function'
    ) {
      const csrfToken = await opts.getCsrfToken();
      if (csrfToken && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }

    /* eslint-disable no-await-in-loop -- Sequential awaits are intentional in this retry loop */
    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      const attemptLabels = { ...metricLabels, attempt };
      metrics.incrementCounter('sync.client.request.attempt', attemptLabels);
      const stopAttemptTimer = metrics.startTimer(
        'sync.client.request.attempt.duration',
        attemptLabels
      );
      const controller = new AbortController();
      const externalSignal = i.signal ?? undefined;
      const abortFromExternal = () => {
        controller.abort();
      };
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
      }
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const r = await fetchImpl(`${baseUrl}/api/v1/sync/${p}`, {
          ...i,
          headers,
          credentials: creds,
          signal: controller.signal,
        });
        if (!r.ok) {
          if (src && isUnauthorizedStatus(r.status)) {
            opts.onUnauthorized?.({ source: src });
            metrics.incrementCounter('sync.client.request.unauthorized', {
              ...metricLabels,
              status: r.status,
            });
          }
          let bodyPreview = '';
          try {
            const rawBody = await r.text();
            const normalized = rawBody.replace(/\s+/g, ' ').trim();
            if (normalized.length > 0) {
              bodyPreview = normalized.slice(0, 200);
            }
          } catch {
            // Best-effort extraction only; keep original status-based error fallback.
          }

          const statusMessage = `${r.status}${r.statusText ? ` ${r.statusText}` : ''}`;
          const detailSuffix = bodyPreview ? `: ${bodyPreview}` : '';
          const httpError = new SyncHttpError(
            `Sync ${p} failed (${statusMessage})${detailSuffix}`,
            r.status
          );
          const shouldRetry = (r.status >= 500 || r.status === 429) && attempt < retryAttempts;
          if (!shouldRetry) {
            const fallback = staleFallback();
            if (fallback && !isUnauthorizedStatus(r.status)) {
              logger.warn('Using stale sync fallback after HTTP failure', {
                endpoint: p,
                status: r.status,
              });
              metrics.incrementCounter('sync.client.request.fallback', {
                ...metricLabels,
                status: r.status,
                reason: 'http_failure',
              });
              return fallback;
            }
            logFinalSyncFailure({
              endpoint: p,
              method,
              source: src,
              status: r.status,
              statusText: r.statusText,
              attempt,
              retryAttempts,
              ...(bodyPreview ? { bodyPreview } : {}),
            });
            markSyncFailureLogged(httpError);
            throw httpError;
          }
          const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
          const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
          logger.warn('Retrying sync request after retryable HTTP status', {
            endpoint: p,
            status: r.status,
            attempt,
          });
          metrics.incrementCounter('sync.client.request.retry', {
            ...metricLabels,
            attempt,
            status: r.status,
            reason: 'http_status',
          });
          await sleep(backoff + jitter, externalSignal);
          continue;
        }

        const parsed = await parse<T>(p, r, s);
        if (src === 'pull') {
          stalePullCache = parsed as SyncPullResponse;
        }
        if (src === 'status') {
          staleStatusCache = parsed as SyncStatusSnapshot;
        }
        metrics.incrementCounter('sync.client.request.success', metricLabels);
        return parsed;
      } catch (error) {
        let retryableError = true;
        if (error instanceof SyncHttpError) {
          retryableError = error.status >= 500 || error.status === 429;
        } else if (error instanceof SyncParseError) {
          retryableError = false;
        }
        const shouldRetry = retryableError && attempt < retryAttempts;
        if (isAbortError(error) && externalSignal?.aborted) {
          metrics.incrementCounter('sync.client.request.aborted', metricLabels);
          throw error;
        }
        if (!shouldRetry) {
          const fallback = staleFallback();
          if (fallback && canUseStaleFallback(error)) {
            logger.warn('Using stale sync fallback after transport failure', {
              endpoint: p,
              error,
            });
            metrics.incrementCounter('sync.client.request.fallback', {
              ...metricLabels,
              reason: error instanceof SyncHttpError ? 'http_failure' : 'transport_failure',
            });
            return fallback;
          }
          if (error instanceof SyncParseError) {
            metrics.incrementCounter('sync.client.request.parse_failure', metricLabels);
          }
          metrics.incrementCounter('sync.client.request.failure', {
            ...metricLabels,
            ...(error instanceof SyncHttpError ? { status: error.status } : {}),
            parseFailure: error instanceof SyncParseError,
            error: error instanceof Error ? error.name : 'unknown',
          });
          if (!wasSyncFailureLogged(error)) {
            logFinalSyncFailure({
              endpoint: p,
              method,
              source: src,
              attempt,
              retryAttempts,
              ...(error instanceof SyncHttpError ? { status: error.status } : {}),
              parseFailure: error instanceof SyncParseError,
              error,
            });
            markSyncFailureLogged(error);
          }
          throw error;
        }
        const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
        logger.warn('Retrying sync request after transport failure', {
          endpoint: p,
          attempt,
          error,
        });
        metrics.incrementCounter('sync.client.request.retry', {
          ...metricLabels,
          attempt,
          reason: error instanceof SyncHttpError ? 'http_status' : 'transport_failure',
        });
        await sleep(backoff + jitter, externalSignal);
      } finally {
        stopAttemptTimer();
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', abortFromExternal);
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    logFinalSyncFailure({
      endpoint: p,
      method,
      source: src,
      retryAttempts,
      status: 503,
    });
    metrics.incrementCounter('sync.client.request.failure', {
      ...metricLabels,
      status: 503,
      error: 'SyncHttpError',
    });
    throw new SyncHttpError(`Sync ${p} failed after retries`, 503);
  };

  return {
    pull: async (v, d, o) => {
      const safeVersion = normalizeSyncVersion(v);
      const safeDeviceID = normalizeDeviceID(d);
      return req(
        'pull',
        {
          method: 'POST',
          headers: await buildH(true),
          body: JSON.stringify({
            last_sync_version: safeVersion,
            device_id: safeDeviceID,
            limit: DEFAULT_PULL_LIMIT,
          }),
          ...(o?.signal ? { signal: o.signal } : {}),
        },
        SyncPullResponseSchema,
        'pull'
      );
    },
    push: async (c, m, d, id, o) => {
      const safeDeviceID = normalizeDeviceID(id);
      return req(
        'push',
        {
          method: 'POST',
          headers: await buildH(true),
          body: JSON.stringify({
            conversations: c,
            messages: m,
            deletions: d,
            device_id: safeDeviceID,
          }),
          ...(o?.signal ? { signal: o.signal } : {}),
        },
        SyncPushResponseSchema,
        'push'
      );
    },
    getStatus: async (o) =>
      req(
        'status',
        { method: 'GET', headers: await buildH(), ...(o?.signal ? { signal: o.signal } : {}) },
        SyncStatusResponseSchema,
        'status'
      ),
    connectRealtime: (on) =>
      createRealtimeConnection({
        baseUrl,
        buildHeaders: buildH,
        fetchImpl,
        notifyUnauthorized: (s) => opts.onUnauthorized?.({ source: s }),
        onEvent: on,
        logger: getSyncLogger(),
        metrics,
        parseJsonResponse: (response, schema) => parse('realtime', response, schema),
        ...definedProps({ getCsrfToken: opts.getCsrfToken }),
      }),
  };
}
