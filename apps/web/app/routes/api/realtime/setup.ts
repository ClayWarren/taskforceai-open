import '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { REALTIME_VOICE_MODEL_ID } from '@taskforceai/client-runtime';

import { logger } from '../../../lib/logger';
import {
  consumeVoiceRequestLimit,
  createVoiceRateLimitResponse,
  getApiRequestAuthSnapshot,
  getGatewayApiKey,
  getGatewayErrorSummary,
  getGatewayStatusCode,
  validateApiRequestCsrf,
  voiceRateLimitHeaders,
} from '../-voice-gateway';

const REALTIME_TOKEN_TTL_SECONDS = 60;

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

  const tokenLimit = await consumeVoiceRequestLimit('realtime-setup', request);
  if (tokenLimit instanceof Response) {
    return tokenLimit;
  }
  if (!tokenLimit.allowed) {
    logger.warn('Realtime voice setup rate limited', {
      limit: tokenLimit.limit,
      retryAfterSeconds: tokenLimit.retryAfterSeconds,
    });
    return createVoiceRateLimitResponse('Realtime voice setup rate limit exceeded', tokenLimit);
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
          ...voiceRateLimitHeaders(tokenLimit),
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
