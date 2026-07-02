import '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { MAX_SPEECH_TEXT_CHARS } from '@taskforceai/client-runtime';

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

const SPEECH_MODEL_ID = 'xai/grok-tts';
const SPEECH_OUTPUT_FORMAT = 'mp3';
const SPEECH_RATE_LIMIT_WINDOW_MS = 60_000;
const SPEECH_MAX_REQUESTS_PER_WINDOW = 12;

const getErrorName = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
};

const getSpeechFailureStatus = (error: unknown): number => {
  if (getErrorName(error) === 'AI_NoSpeechGeneratedError') {
    return 422;
  }
  return getGatewayStatusCode(error);
};

const getSpeechFailureMessage = (error: unknown): string => {
  if (getErrorName(error) === 'AI_NoSpeechGeneratedError') {
    return 'No speech generated.';
  }
  return 'Speech generation failed';
};

const getSpeechText = async (request: Request): Promise<string | Response> => {
  let payload: { text?: unknown };
  try {
    payload = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: 'Invalid speech request' }, { status: 400 });
  }

  if (typeof payload.text !== 'string') {
    return Response.json({ error: 'Text is required' }, { status: 400 });
  }

  const text = payload.text.trim();
  if (!text) {
    return Response.json({ error: 'Text is required' }, { status: 400 });
  }
  if (text.length > MAX_SPEECH_TEXT_CHARS) {
    return Response.json({ error: 'Text is too long for speech generation' }, { status: 413 });
  }

  return text;
};

const handleSpeechGenerate = async ({ request }: { request: Request }) => {
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
  const rateLimit = consumeVoiceRequestLimit('speech', request, auth, {
    maxRequests: SPEECH_MAX_REQUESTS_PER_WINDOW,
    windowMs: SPEECH_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.allowed) {
    return createVoiceRateLimitResponse('Speech generation rate limit exceeded', rateLimit);
  }

  const apiKey = getGatewayApiKey();
  if (!apiKey) {
    logger.error('Speech generation missing AI Gateway API key');
    return Response.json(
      { error: 'Speech generation is not configured for this deployment' },
      { status: 503 }
    );
  }

  const text = await getSpeechText(request);
  if (text instanceof Response) {
    return text;
  }

  try {
    const [{ createGateway }, { generateSpeech }] = await Promise.all([
      import('@ai-sdk/gateway'),
      import('ai'),
    ]);
    const result = await generateSpeech({
      model: createGateway({ apiKey }).speech(SPEECH_MODEL_ID),
      text,
      outputFormat: SPEECH_OUTPUT_FORMAT,
      maxRetries: 1,
    });
    const audioBuffer = new ArrayBuffer(result.audio.uint8Array.byteLength);
    new Uint8Array(audioBuffer).set(result.audio.uint8Array);

    return new Response(audioBuffer, {
      headers: {
        'cache-control': 'private, no-store',
        'content-type': result.audio.mediaType,
        'x-taskforceai-audio-format': result.audio.format,
        ...voiceRateLimitHeaders(rateLimit),
      },
    });
  } catch (error) {
    const status = getSpeechFailureStatus(error);
    logger.error('Speech generation failed', {
      error: getGatewayErrorSummary(error),
      model: SPEECH_MODEL_ID,
    });
    return Response.json({ error: getSpeechFailureMessage(error) }, { status });
  }
};

export const Route = createFileRoute('/api/speech/generate')({
  server: {
    handlers: {
      POST: handleSpeechGenerate,
    },
  },
});
