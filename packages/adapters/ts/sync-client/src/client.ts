import { z } from 'zod';
import { abortableDelay } from '@taskforceai/api-client/utils/abortable-delay';

import { SYNC_PULL_SAFE_ITEM_LIMIT } from '@taskforceai/client-core/sync/limits';
import { definedProps } from '@taskforceai/client-core/utils/object';

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
type StalePullCache = {
  key: string;
  response: SyncPullResponse;
};
type StaleStatusCache = {
  authHeader: string;
  response: SyncStatusSnapshot;
};

export interface HttpSyncClientOptions {
  onUnauthorized?: (c: { source: UnauthorizedSource }) => void;
  getCsrfToken?: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  metrics?: SyncMetricsCollector;
  isProduction?: boolean;
  credentials?: RequestCredentials;
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
const RETRY_SYNC_REQUEST = Symbol('retrySyncRequest');
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
const isTransientHttpStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600);
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

let fallbackSyncRequestSequence = 0;
const createSyncRequestID = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackSyncRequestSequence += 1;
  return `sync-${Date.now().toString(36)}-${fallbackSyncRequestSequence.toString(36)}`;
};

const canUseStaleFallback = (error: unknown): boolean => {
  if (error instanceof SyncParseError) {
    return false;
  }
  return !(error instanceof SyncHttpError) || isTransientHttpStatus(error.status);
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

export function createHttpSyncClient(
  baseUrl: string,
  getToken: () => string | null | Promise<string | null>,
  opts: HttpSyncClientOptions = {}
): SyncClient {
  const logger = getSyncLogger();
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const metrics = opts.metrics ?? noopSyncMetrics;
  const credentials = opts.credentials ?? 'include';
  const timeoutMs = Math.max(1000, opts.resilience?.timeoutMs ?? 30000);
  const retryAttempts = Math.max(1, opts.resilience?.retryAttempts ?? 3);
  const baseDelayMs = Math.max(10, opts.resilience?.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, opts.resilience?.maxDelayMs ?? 2000);
  const jitterMs = Math.max(0, opts.resilience?.jitterMs ?? 100);
  let stalePullCache: StalePullCache | null = null;
  let staleStatusCache: StaleStatusCache | null = null;

  const clearStaleCaches = () => {
    stalePullCache = null;
    staleStatusCache = null;
  };

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

  type RequestFailureContext<T> = {
    endpoint: string;
    method: string;
    source?: UnauthorizedSource;
    attempt: number;
    metricLabels: Record<string, string>;
    staleFallback: () => T | null;
    externalSignal?: AbortSignal;
  };

  const retryAfterDelay = async (
    context: RequestFailureContext<unknown>,
    warning: string,
    logMetadata: Record<string, unknown>,
    metricMetadata: Record<string, unknown>
  ): Promise<typeof RETRY_SYNC_REQUEST> => {
    const backoff = Math.min(baseDelayMs * 2 ** (context.attempt - 1), maxDelayMs);
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
    logger.warn(warning, logMetadata);
    metrics.incrementCounter('sync.client.request.retry', {
      ...context.metricLabels,
      attempt: context.attempt,
      ...metricMetadata,
    });
    await abortableDelay(backoff + jitter, context.externalSignal);
    return RETRY_SYNC_REQUEST;
  };

  const handleHttpFailure = async <T>(
    response: Response,
    context: RequestFailureContext<T>
  ): Promise<T | typeof RETRY_SYNC_REQUEST> => {
    if (context.source && isUnauthorizedStatus(response.status)) {
      opts.onUnauthorized?.({ source: context.source });
      clearStaleCaches();
      metrics.incrementCounter('sync.client.request.unauthorized', {
        ...context.metricLabels,
        status: response.status,
      });
    }
    let bodyPreview = '';
    try {
      bodyPreview = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch {
      // Best-effort extraction only; keep original status-based error fallback.
    }
    const statusMessage = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const detailSuffix = bodyPreview ? `: ${bodyPreview}` : '';
    const error = new SyncHttpError(
      `Sync ${context.endpoint} failed (${statusMessage})${detailSuffix}`,
      response.status
    );
    const shouldRetry = isTransientHttpStatus(response.status) && context.attempt < retryAttempts;
    if (shouldRetry) {
      return retryAfterDelay(
        context,
        'Retrying sync request after retryable HTTP status',
        { endpoint: context.endpoint, status: response.status, attempt: context.attempt },
        { status: response.status, reason: 'http_status' }
      );
    }
    const fallback = context.staleFallback();
    if (fallback && isTransientHttpStatus(response.status)) {
      logger.warn('Using stale sync fallback after HTTP failure', {
        endpoint: context.endpoint,
        status: response.status,
      });
      metrics.incrementCounter('sync.client.request.fallback', {
        ...context.metricLabels,
        status: response.status,
        reason: 'http_failure',
      });
      return fallback;
    }
    logFinalSyncFailure({
      endpoint: context.endpoint,
      method: context.method,
      source: context.source,
      status: response.status,
      statusText: response.statusText,
      attempt: context.attempt,
      retryAttempts,
      ...(bodyPreview ? { bodyPreview } : {}),
    });
    markSyncFailureLogged(error);
    throw error;
  };

  const handleRequestError = async <T>(
    error: unknown,
    context: RequestFailureContext<T>
  ): Promise<T | typeof RETRY_SYNC_REQUEST> => {
    const retryable =
      error instanceof SyncHttpError
        ? isTransientHttpStatus(error.status)
        : !(error instanceof SyncParseError);
    if (isAbortError(error) && context.externalSignal?.aborted) {
      metrics.incrementCounter('sync.client.request.aborted', context.metricLabels);
      throw error;
    }
    if (retryable && context.attempt < retryAttempts) {
      return retryAfterDelay(
        context,
        'Retrying sync request after transport failure',
        { endpoint: context.endpoint, attempt: context.attempt, error },
        {
          reason: error instanceof SyncHttpError ? 'http_status' : 'transport_failure',
        }
      );
    }
    const fallback = context.staleFallback();
    if (fallback && canUseStaleFallback(error)) {
      logger.warn('Using stale sync fallback after transport failure', {
        endpoint: context.endpoint,
        error,
      });
      metrics.incrementCounter('sync.client.request.fallback', {
        ...context.metricLabels,
        reason: error instanceof SyncHttpError ? 'http_failure' : 'transport_failure',
      });
      return fallback;
    }
    if (error instanceof SyncParseError) {
      metrics.incrementCounter('sync.client.request.parse_failure', context.metricLabels);
    }
    metrics.incrementCounter('sync.client.request.failure', {
      ...context.metricLabels,
      ...(error instanceof SyncHttpError ? { status: error.status } : {}),
      parseFailure: error instanceof SyncParseError,
      error: error instanceof Error ? error.name : 'unknown',
    });
    if (!wasSyncFailureLogged(error)) {
      logFinalSyncFailure({
        endpoint: context.endpoint,
        method: context.method,
        source: context.source,
        attempt: context.attempt,
        retryAttempts,
        ...(error instanceof SyncHttpError ? { status: error.status } : {}),
        parseFailure: error instanceof SyncParseError,
        error,
      });
      markSyncFailureLogged(error);
    }
    throw error;
  };

  const req = async <T>(
    p: string,
    i: RequestInit,
    s: z.ZodTypeAny,
    src?: UnauthorizedSource,
    cacheKey?: string
  ): Promise<T> => {
    const requestAuthHeader = new Headers(i.headers).get('Authorization') ?? '';
    const staleFallback = (): T | null => {
      if (src === 'pull' && stalePullCache && stalePullCache.key === cacheKey) {
        return stalePullCache.response as T;
      }
      if (
        src === 'status' &&
        staleStatusCache &&
        staleStatusCache.authHeader === requestAuthHeader
      ) {
        return staleStatusCache.response as T;
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
          credentials,
          signal: controller.signal,
        });
        if (!r.ok) {
          const result = await handleHttpFailure(r, {
            endpoint: p,
            method,
            source: src,
            attempt,
            metricLabels,
            staleFallback,
            externalSignal,
          });
          if (result === RETRY_SYNC_REQUEST) continue;
          return result;
        }

        const parsed = await parse<T>(p, r, s);
        if (src === 'pull') {
          stalePullCache = { key: cacheKey ?? '', response: parsed as SyncPullResponse };
        }
        if (src === 'status') {
          staleStatusCache = {
            authHeader: requestAuthHeader,
            response: parsed as SyncStatusSnapshot,
          };
        }
        metrics.incrementCounter('sync.client.request.success', metricLabels);
        return parsed;
      } catch (error) {
        const result = await handleRequestError(error, {
          endpoint: p,
          method,
          source: src,
          attempt,
          metricLabels,
          staleFallback,
          externalSignal,
        });
        if (result === RETRY_SYNC_REQUEST) continue;
        return result;
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
      const headers = await buildH(true);
      const authHeader = new Headers(headers).get('Authorization') ?? '';
      return req(
        'pull',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            last_sync_version: safeVersion,
            device_id: safeDeviceID,
            limit: DEFAULT_PULL_LIMIT,
          }),
          ...(o?.signal ? { signal: o.signal } : {}),
        },
        SyncPullResponseSchema,
        'pull',
        `${authHeader}:${safeDeviceID}:${safeVersion}`
      );
    },
    push: async (c, m, d, id, o) => {
      const safeDeviceID = normalizeDeviceID(id);
      const headers = await buildH(true);
      headers['X-Sync-Id'] = createSyncRequestID();
      return req(
        'push',
        {
          method: 'POST',
          headers,
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
        isProduction: opts.isProduction,
        parseJsonResponse: (response, schema) => parse('realtime', response, schema),
        ...definedProps({ getCsrfToken: opts.getCsrfToken }),
      }),
  };
}
