import { readStatusCode } from '@taskforceai/api-client/api/response';
import { type ZodTypeAny, z } from 'zod';

import { noopSyncMetrics, type SyncMetricsCollector } from './metrics';
import type { BroadcastEvent, UnauthorizedSource } from './types';
import { parseBroadcastEventPayload } from './utils';
import { TokenResponseSchema } from './validation';

type Logger = {
  warn: (message: string, fields?: Record<string, unknown>) => void;
  debug: (message: string, fields?: Record<string, unknown>) => void;
};
type ParseJsonResponse = <T>(response: Response, schema: ZodTypeAny) => Promise<T>;
type SyncTokenResult =
  | { ok: true; token: string }
  | {
      ok: false;
      reason: 'unauthorized' | 'http_failure' | 'missing_token' | 'exception';
      status?: number;
    };

type PollUrlResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'missing_auth' | 'missing_token';
      countAsError: boolean;
      unauthorized: boolean;
    };

interface Params {
  baseUrl: string;
  buildHeaders: (j?: boolean) => Promise<Record<string, string>>;
  fetchImpl: typeof fetch;
  getCsrfToken?: () => string | Promise<string>;
  notifyUnauthorized: (s: UnauthorizedSource) => void;
  onEvent: (e: BroadcastEvent) => void;
  logger: Logger;
  metrics?: SyncMetricsCollector;
  parseJsonResponse: ParseJsonResponse;
  isProduction?: boolean;
  requestTimeoutMs?: number;
}

const normalizeBroadcastType = (rawType: string): string => {
  switch (rawType) {
    case 'sync_required':
      return 'sync:required';
    case 'conversation_created':
      return 'conversation:created';
    case 'conversation_updated':
      return 'conversation:updated';
    case 'conversation_deleted':
      return 'conversation:deleted';
    case 'message_created':
      return 'message:created';
    case 'message_updated':
      return 'message:updated';
    case 'message_deleted':
      return 'message:deleted';
    default:
      return rawType;
  }
};

const PollResponseSchema = z.object({
  messages: z.array(
    z
      .object({
        type: z.string(),
        version: z.number(),
        id: z.string(),
        userId: z.string().optional(),
        conversationId: z.number().optional(),
        messageId: z.string().optional(),
        connectionId: z.string().optional(),
      })
      .passthrough()
  ),
  lastId: z.string(),
  latestVersion: z.number().int().nonnegative().optional().default(0),
});

type PollResponse = z.infer<typeof PollResponseSchema>;

const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_IDLE_POLL_INTERVAL_MS = 15000;
const MAX_ERROR_POLL_INTERVAL_MS = 30000;
const EMPTY_POLL_BACKOFF_THRESHOLD = 2;
const DEFAULT_TOKEN_TTL_SECONDS = 120;
const TOKEN_REFRESH_SAFETY_MS = 15000;
const DEFAULT_REALTIME_REQUEST_TIMEOUT_MS = 30000;

export const createRealtimeConnection = (p: Params): (() => void) => {
  const {
    baseUrl,
    buildHeaders,
    fetchImpl,
    getCsrfToken,
    notifyUnauthorized,
    onEvent,
    logger,
    metrics = noopSyncMetrics,
    parseJsonResponse,
    isProduction = false,
    requestTimeoutMs: configuredRequestTimeoutMs,
  } = p;

  const requestTimeoutMs = Math.max(
    1,
    configuredRequestTimeoutMs ?? DEFAULT_REALTIME_REQUEST_TIMEOUT_MS
  );

  let closed = false;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastEventId = '$';
  let lastKnownVersion = 0;
  let consecutiveErrors = 0;
  let consecutiveEmptyPolls = 0;
  let lastTokenWarningAt = 0;
  let currentPollInterval = DEFAULT_POLL_INTERVAL_MS;
  let pollInFlight = false;
  let cachedSyncToken = '';
  let cachedSyncTokenRefreshAt = 0;
  let cachedTokenAuthHeader = '';
  const activeRequestControllers = new Set<AbortController>();

  const closeConnection = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    for (const controller of activeRequestControllers) {
      controller.abort();
    }
    metrics.incrementCounter('sync.client.realtime.connection.closed');
  };

  const fetchWithTimeout = async (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const controller = new AbortController();
    activeRequestControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    if (closed) {
      controller.abort();
    }
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      activeRequestControllers.delete(controller);
    }
  };

  const clearCachedToken = () => {
    cachedSyncToken = '';
    cachedSyncTokenRefreshAt = 0;
    cachedTokenAuthHeader = '';
  };

  const hasValidCachedToken = (authHeader: string): boolean =>
    cachedSyncToken !== '' &&
    cachedTokenAuthHeader === authHeader &&
    Date.now() < cachedSyncTokenRefreshAt;

  const updatePollInterval = (newIntervalMs: number, reason: 'idle' | 'error' | 'activity') => {
    if (newIntervalMs === currentPollInterval) {
      return;
    }
    currentPollInterval = newIntervalMs;
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = setInterval(() => void poll(), currentPollInterval);
    }
    logger.debug('Updated sync poll interval', { newInterval: currentPollInterval, reason });
    metrics.incrementCounter('sync.client.realtime.poll_interval_changed', {
      reason,
      intervalMs: currentPollInterval,
    });
  };

  const getSyncToken = async (
    path: string,
    headers: Record<string, string>
  ): Promise<SyncTokenResult> => {
    const authHeader = headers['Authorization'] ?? '';

    if (hasValidCachedToken(authHeader)) {
      metrics.incrementCounter('sync.client.realtime.token.cache_hit');
      return { ok: true, token: cachedSyncToken };
    }

    const stopTokenTimer = metrics.startTimer('sync.client.realtime.token.duration');
    try {
      const tUrl = baseUrl ? new URL(`${path}/token`, baseUrl).toString() : `${path}/token`;
      if (typeof getCsrfToken === 'function' && !headers['X-CSRF-Token']) {
        const csrfToken = await getCsrfToken();
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken;
        }
      }
      const r = await fetchWithTimeout(tUrl, {
        method: 'POST',
        headers,
        credentials: 'include',
      });

      if (!r.ok) {
        if (r.status === 401 || r.status === 403) {
          clearCachedToken();
          notifyUnauthorized('realtime-token');
        } else {
          const now = Date.now();
          if (now - lastTokenWarningAt >= 30000) {
            lastTokenWarningAt = now;
            logger.warn('Unable to fetch sync realtime token', {
              status: r.status,
              statusText: r.statusText,
            });
          }
        }
        metrics.incrementCounter('sync.client.realtime.token.failure', {
          status: r.status,
          unauthorized: r.status === 401 || r.status === 403,
        });
        return {
          ok: false,
          reason: r.status === 401 || r.status === 403 ? 'unauthorized' : 'http_failure',
          status: r.status,
        };
      }

      const data = await parseJsonResponse<{ token?: string; expires_in?: number }>(
        r,
        TokenResponseSchema
      );
      const token = data.token;
      if (!token) {
        clearCachedToken();
        metrics.incrementCounter('sync.client.realtime.token.failure', { reason: 'missing_token' });
        return { ok: false, reason: 'missing_token' };
      }

      const ttlSeconds =
        data.expires_in && Number.isFinite(data.expires_in) && data.expires_in > 0
          ? data.expires_in
          : DEFAULT_TOKEN_TTL_SECONDS;
      const ttlMs = Math.floor(ttlSeconds * 1000);
      const refreshSafetyMs = Math.min(
        TOKEN_REFRESH_SAFETY_MS,
        Math.max(1000, Math.floor(ttlMs / 4))
      );
      cachedSyncToken = token;
      cachedTokenAuthHeader = authHeader;
      cachedSyncTokenRefreshAt = Date.now() + ttlMs - refreshSafetyMs;
      metrics.incrementCounter('sync.client.realtime.token.success');
      return { ok: true, token };
    } catch (e) {
      logger.warn('Failed to fetch sync realtime token', { error: e });
      metrics.incrementCounter('sync.client.realtime.token.failure', {
        reason: 'exception',
        error: e instanceof Error ? e.name : 'unknown',
      });
      return { ok: false, reason: 'exception' };
    } finally {
      stopTokenTimer();
    }
  };

  const getUrl = async (): Promise<PollUrlResult> => {
    const path = '/api/v1/sync/realtime';
    let url = baseUrl ? new URL(path, baseUrl).toString() : path;

    const headers = await buildHeaders();
    const authHeader = headers['Authorization'];

    // Guest users or missing tokens should never trigger a poll
    if (!authHeader || authHeader === 'Bearer null' || authHeader === 'Bearer undefined') {
      clearCachedToken();
      metrics.incrementCounter('sync.client.realtime.poll.skipped', { reason: 'missing_auth' });
      return {
        ok: false,
        reason: 'missing_auth',
        countAsError: false,
        unauthorized: false,
      };
    }

    const tokenResult = await getSyncToken(path, headers);
    if (!tokenResult.ok) {
      metrics.incrementCounter('sync.client.realtime.poll.skipped', { reason: 'missing_token' });
      return {
        ok: false,
        reason: 'missing_token',
        countAsError: true,
        unauthorized: tokenResult.reason === 'unauthorized',
      };
    }
    url += `${url.includes('?') ? '&' : '?'}sync_token=${encodeURIComponent(tokenResult.token)}`;

    if (lastEventId && lastEventId !== '$') {
      url += `${url.includes('?') ? '&' : '?'}last_id=${encodeURIComponent(lastEventId)}`;
    }
    url += `${url.includes('?') ? '&' : '?'}last_version=${lastKnownVersion}`;

    return { ok: true, url };
  };

  const handleFailedPollResponse = (response: Response): boolean => {
    const unauthorized = response.status === 401 || response.status === 403;
    if (unauthorized) {
      clearCachedToken();
      notifyUnauthorized('realtime-poll');
    }
    const expectedTimeout = response.status === 504 && isProduction;
    if ((response.status !== 401 || !isProduction) && !expectedTimeout) {
      logger.warn('Sync poll request failed', {
        status: response.status,
        statusText: response.statusText,
      });
    }
    if (expectedTimeout) {
      metrics.incrementCounter('sync.client.realtime.poll.success', {
        messages: 0,
        timeout: true,
      });
      handleEmptyPoll();
      return true;
    }
    metrics.incrementCounter('sync.client.realtime.poll.failure', {
      status: response.status,
      unauthorized,
    });
    handlePollError();
    if (unauthorized) closeConnection();
    return true;
  };

  const deliverPollMessages = (data: PollResponse): void => {
    for (const msg of data.messages) {
      const normalizedType = normalizeBroadcastType(msg.type);
      const eventPayload: Record<string, unknown> = { type: normalizedType };
      if (msg.userId !== undefined) eventPayload['userId'] = msg.userId;
      if (msg.conversationId !== undefined) eventPayload['conversationId'] = msg.conversationId;
      if (msg.messageId !== undefined) eventPayload['messageId'] = msg.messageId;
      if (msg.connectionId !== undefined) eventPayload['connectionId'] = msg.connectionId;

      const result = parseBroadcastEventPayload(eventPayload);
      if (result.ok) {
        metrics.incrementCounter('sync.client.realtime.message.delivered', {
          type: normalizedType,
        });
        onEvent(result.value);
      } else {
        logger.warn('Dropping malformed sync message', {
          error: result.error,
          messageId: msg.id,
          type: msg.type,
        });
        metrics.incrementCounter('sync.client.realtime.message.dropped', {
          type: msg.type,
          reason: 'parse_failure',
        });
      }
    }
  };

  const poll = async () => {
    if (closed) {
      return;
    }
    if (pollInFlight) {
      metrics.incrementCounter('sync.client.realtime.poll.skipped', { reason: 'in_flight' });
      return;
    }
    pollInFlight = true;
    metrics.incrementCounter('sync.client.realtime.poll.total');
    const stopPollTimer = metrics.startTimer('sync.client.realtime.poll.duration');

    try {
      const urlResult = await getUrl();
      if (!urlResult.ok) {
        if (urlResult.countAsError) {
          handlePollError();
        }
        if (urlResult.unauthorized) {
          closeConnection();
        }
        return;
      }

      const headers = await buildHeaders();
      const response = await fetchWithTimeout(urlResult.url, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        handleFailedPollResponse(response);
        return;
      }

      const data: PollResponse = await parseJsonResponse(response, PollResponseSchema);

      if (closed) return;

      consecutiveErrors = 0;
      metrics.incrementCounter('sync.client.realtime.poll.success', {
        messages: data.messages.length,
      });
      if (data.messages.length > 0) {
        consecutiveEmptyPolls = 0;
        if (currentPollInterval !== DEFAULT_POLL_INTERVAL_MS) {
          updatePollInterval(DEFAULT_POLL_INTERVAL_MS, 'activity');
        }
      } else {
        handleEmptyPoll();
      }

      deliverPollMessages(data);
      lastKnownVersion = Math.max(
        lastKnownVersion,
        data.latestVersion,
        ...data.messages.map((message) => message.version)
      );

      if (data.lastId && data.lastId !== '$') {
        lastEventId = data.lastId;
      }
    } catch (error) {
      const status = readStatusCode(error);
      if (status !== 401 || !isProduction) {
        logger.warn('Sync poll error', { error });
      }
      if (status === 401 || status === 403) {
        clearCachedToken();
      }
      metrics.incrementCounter('sync.client.realtime.poll.failure', {
        status,
        unauthorized: status === 401 || status === 403,
        reason: 'exception',
        error: error instanceof Error ? error.name : 'unknown',
      });
      handlePollError();
    } finally {
      pollInFlight = false;
      stopPollTimer();
    }
  };

  const handlePollError = () => {
    consecutiveErrors++;
    consecutiveEmptyPolls = 0;
    if (consecutiveErrors >= 3 && pollIntervalId) {
      const newInterval = Math.min(currentPollInterval * 2, MAX_ERROR_POLL_INTERVAL_MS);
      if (newInterval !== currentPollInterval) {
        updatePollInterval(newInterval, 'error');
      }
    }
  };

  const handleEmptyPoll = () => {
    consecutiveErrors = 0;
    consecutiveEmptyPolls += 1;
    if (consecutiveEmptyPolls >= EMPTY_POLL_BACKOFF_THRESHOLD) {
      const newInterval = Math.min(currentPollInterval * 2, MAX_IDLE_POLL_INTERVAL_MS);
      updatePollInterval(newInterval, 'idle');
    }
  };

  const startPolling = () => {
    if (closed) return;
    metrics.incrementCounter('sync.client.realtime.connection.started');
    void poll();
    pollIntervalId = setInterval(() => void poll(), DEFAULT_POLL_INTERVAL_MS);
  };

  startPolling();

  return () => {
    closeConnection();
  };
};
