import { env } from '@taskforceai/shared/config/env';
import { readStatusCode } from '@taskforceai/shared/utils/api';
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
});

type PollResponse = z.infer<typeof PollResponseSchema>;

const DEFAULT_POLL_INTERVAL_MS = 3000;
const MAX_IDLE_POLL_INTERVAL_MS = 15000;
const MAX_ERROR_POLL_INTERVAL_MS = 30000;
const EMPTY_POLL_BACKOFF_THRESHOLD = 2;
const DEFAULT_TOKEN_TTL_SECONDS = 120;
const TOKEN_REFRESH_SAFETY_MS = 15000;

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
  } = p;

  let closed = false;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastEventId = '$';
  let consecutiveErrors = 0;
  let consecutiveEmptyPolls = 0;
  let lastTokenWarningAt = 0;
  let currentPollInterval = DEFAULT_POLL_INTERVAL_MS;
  let pollInFlight = false;
  let cachedSyncToken = '';
  let cachedSyncTokenRefreshAt = 0;
  let cachedTokenAuthHeader = '';

  const clearCachedToken = () => {
    cachedSyncToken = '';
    cachedSyncTokenRefreshAt = 0;
    cachedTokenAuthHeader = '';
  };

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
  ): Promise<string | null> => {
    const authHeader = headers['Authorization'] ?? '';

    if (
      cachedSyncToken !== '' &&
      cachedTokenAuthHeader === authHeader &&
      Date.now() < cachedSyncTokenRefreshAt
    ) {
      metrics.incrementCounter('sync.client.realtime.token.cache_hit');
      return cachedSyncToken;
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
      const r = await fetchImpl(tUrl, { method: 'POST', headers, credentials: 'include' });

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
        return null;
      }

      const data = await parseJsonResponse<{ token?: string; expires_in?: number }>(
        r,
        TokenResponseSchema
      );
      const token = data.token;
      if (!token) {
        clearCachedToken();
        metrics.incrementCounter('sync.client.realtime.token.failure', { reason: 'missing_token' });
        return null;
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
      return token;
    } catch (e) {
      logger.warn('Failed to fetch sync realtime token', { error: e });
      metrics.incrementCounter('sync.client.realtime.token.failure', {
        reason: 'exception',
        error: e instanceof Error ? e.name : 'unknown',
      });
      return null;
    } finally {
      stopTokenTimer();
    }
  };

  const getUrl = async (): Promise<string | null> => {
    const path = '/api/v1/sync/realtime';
    let url = baseUrl ? new URL(path, baseUrl).toString() : path;

    const headers = await buildHeaders();
    const authHeader = headers['Authorization'];

    // Guest users or missing tokens should never trigger a poll
    if (!authHeader || authHeader === 'Bearer null' || authHeader === 'Bearer undefined') {
      clearCachedToken();
      metrics.incrementCounter('sync.client.realtime.poll.skipped', { reason: 'missing_auth' });
      return null;
    }

    const token = await getSyncToken(path, headers);
    if (!token) {
      metrics.incrementCounter('sync.client.realtime.poll.skipped', { reason: 'missing_token' });
      return null;
    }
    url += `${url.includes('?') ? '&' : '?'}sync_token=${encodeURIComponent(token)}`;

    if (lastEventId && lastEventId !== '$') {
      url += `${url.includes('?') ? '&' : '?'}last_id=${encodeURIComponent(lastEventId)}`;
    }

    return url;
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
      const url = await getUrl();
      if (!url) return;

      const headers = await buildHeaders(true);
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearCachedToken();
          notifyUnauthorized('realtime-poll');
        }
        const isExpectedLongPollTimeout = response.status === 504 && env.NODE_ENV === 'production';
        if (
          (response.status !== 401 || env.NODE_ENV !== 'production') &&
          !isExpectedLongPollTimeout
        ) {
          logger.warn('Sync poll request failed', {
            status: response.status,
            statusText: response.statusText,
          });
        }
        metrics.incrementCounter('sync.client.realtime.poll.failure', {
          status: response.status,
          unauthorized: response.status === 401 || response.status === 403,
        });
        handlePollError();
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
        consecutiveEmptyPolls += 1;
        if (consecutiveEmptyPolls >= EMPTY_POLL_BACKOFF_THRESHOLD) {
          const newInterval = Math.min(currentPollInterval * 2, MAX_IDLE_POLL_INTERVAL_MS);
          updatePollInterval(newInterval, 'idle');
        }
      }

      for (const msg of data.messages) {
        const normalizedType = normalizeBroadcastType(msg.type);
        const eventPayload: Record<string, unknown> = { type: normalizedType };
        if (msg.userId !== undefined) eventPayload['userId'] = msg.userId;
        if (msg.conversationId !== undefined) eventPayload['conversationId'] = msg.conversationId;
        if (msg.messageId !== undefined) eventPayload['messageId'] = msg.messageId;
        if (msg.connectionId !== undefined) eventPayload['connectionId'] = msg.connectionId;

        const res = parseBroadcastEventPayload(eventPayload);
        if (res.ok) {
          metrics.incrementCounter('sync.client.realtime.message.delivered', {
            type: normalizedType,
          });
          onEvent(res.value);
        } else {
          logger.warn('Dropping malformed sync message', {
            error: res.error,
            messageId: msg.id,
            type: msg.type,
          });
          metrics.incrementCounter('sync.client.realtime.message.dropped', {
            type: msg.type,
            reason: 'parse_failure',
          });
        }
      }

      if (data.lastId && data.lastId !== '$') {
        lastEventId = data.lastId;
      }
    } catch (error) {
      const status = readStatusCode(error);
      if (status !== 401 || env.NODE_ENV !== 'production') {
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

  const startPolling = () => {
    if (closed) return;
    metrics.incrementCounter('sync.client.realtime.connection.started');
    void poll();
    pollIntervalId = setInterval(() => void poll(), DEFAULT_POLL_INTERVAL_MS);
  };

  startPolling();

  return () => {
    closed = true;
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    metrics.incrementCounter('sync.client.realtime.connection.closed');
  };
};
