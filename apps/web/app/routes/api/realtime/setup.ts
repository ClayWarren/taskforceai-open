import '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { REALTIME_VOICE_MODEL_ID } from '@taskforceai/client-runtime';

import { logger } from '../../../lib/logger';
import {
  getApiRequestAuthSnapshot,
  getGatewayApiKey,
  getGatewayErrorSummary,
  getGatewayStatusCode,
  validateApiRequestCsrf,
  type ApiRequestAuthSnapshot,
} from '../-voice-gateway';

const REALTIME_TOKEN_TTL_SECONDS = 60;
const REALTIME_TOKEN_LIMIT_WINDOW_MS = 60_000;
const REALTIME_TOKEN_MAX_PER_WINDOW = 6;

type RealtimeTokenLimitEntry = {
  count: number;
  resetAt: number;
};

const realtimeTokenLimits = new Map<string, RealtimeTokenLimitEntry>();

const getClientIp = (request: Request): string => {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor && forwardedFor.length > 0 ? forwardedFor : 'unknown';
};

const getRealtimeTokenLimitKey = (request: Request, auth: ApiRequestAuthSnapshot): string => {
  const user = auth?.user;
  if (user && typeof user.id === 'number' && user.id > 0) {
    return `user:${user.id}`;
  }

  const email = user?.email?.trim().toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return `ip:${getClientIp(request)}`;
};

const pruneExpiredRealtimeTokenLimits = (now: number) => {
  if (realtimeTokenLimits.size < 1_000) {
    return;
  }

  for (const [key, entry] of realtimeTokenLimits) {
    if (entry.resetAt <= now) {
      realtimeTokenLimits.delete(key);
    }
  }
};

const consumeRealtimeTokenLimit = (key: string, now = Date.now()) => {
  pruneExpiredRealtimeTokenLimits(now);

  const current = realtimeTokenLimits.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + REALTIME_TOKEN_LIMIT_WINDOW_MS;
    realtimeTokenLimits.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: REALTIME_TOKEN_MAX_PER_WINDOW,
      remaining: REALTIME_TOKEN_MAX_PER_WINDOW - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= REALTIME_TOKEN_MAX_PER_WINDOW) {
    return {
      allowed: false,
      limit: REALTIME_TOKEN_MAX_PER_WINDOW,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    limit: REALTIME_TOKEN_MAX_PER_WINDOW,
    remaining: REALTIME_TOKEN_MAX_PER_WINDOW - current.count,
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  };
};

export const resetRealtimeTokenLimitForTests = () => {
  realtimeTokenLimits.clear();
};

const handleRealtimeSetup = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await getApiRequestAuthSnapshot(request);
  if (auth?.isAuthenticated !== true) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }
  const csrfFailure = validateApiRequestCsrf(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const apiKey = getGatewayApiKey();
  if (!apiKey) {
    logger.error('Realtime voice setup missing AI Gateway API key');
    return Response.json(
      { error: 'Realtime voice is not configured for this deployment' },
      { status: 503 }
    );
  }

  const limitKey = getRealtimeTokenLimitKey(request, auth);
  const tokenLimit = consumeRealtimeTokenLimit(limitKey);
  if (!tokenLimit.allowed) {
    logger.warn('Realtime voice setup rate limited', {
      key: limitKey,
      limit: tokenLimit.limit,
      retryAfterSeconds: tokenLimit.retryAfterSeconds,
    });
    return Response.json(
      { error: 'Realtime voice setup rate limit exceeded' },
      {
        status: 429,
        headers: {
          'cache-control': 'private, no-store',
          'retry-after': String(tokenLimit.retryAfterSeconds),
          'x-ratelimit-limit': String(tokenLimit.limit),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.ceil(tokenLimit.resetAt / 1_000)),
        },
      }
    );
  }

  try {
    const { createGateway } = await import('@ai-sdk/gateway');
    const token = await createGateway({ apiKey }).experimental_realtime.getToken({
      model: REALTIME_VOICE_MODEL_ID,
      expiresAfterSeconds: REALTIME_TOKEN_TTL_SECONDS,
    });

    return Response.json(
      {
        ...token,
        tools: [],
      },
      {
        headers: {
          'cache-control': 'private, no-store',
          'x-ratelimit-limit': String(tokenLimit.limit),
          'x-ratelimit-remaining': String(tokenLimit.remaining),
          'x-ratelimit-reset': String(Math.ceil(tokenLimit.resetAt / 1_000)),
        },
      }
    );
  } catch (error) {
    const status = getGatewayStatusCode(error);
    logger.error('Realtime voice setup failed', {
      error: getGatewayErrorSummary(error),
      model: REALTIME_VOICE_MODEL_ID,
    });
    return Response.json({ error: 'Realtime voice setup failed' }, { status });
  }
};

export const Route = createFileRoute('/api/realtime/setup')({
  server: {
    handlers: {
      POST: handleRealtimeSetup,
    },
  },
});
