import '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';

import { logger } from '../../../lib/logger';
import {
  consumeVoiceRequestLimit,
  createVoiceRateLimitResponse,
  getApiRequestAuthSnapshot,
  getGatewayApiKey,
  getGatewayErrorSummary,
  getGatewayStatusCode,
  recordCompletedVoiceUsage,
  validateApiRequestCsrf,
  voiceRateLimitHeaders,
} from '../-voice-gateway';

const DICTATION_STT_MODEL_ID = 'xai/grok-stt';
const DICTATION_AUDIO_FIELD = 'audio';
const MAX_DICTATION_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_DICTATION_MULTIPART_REQUEST_BYTES = MAX_DICTATION_AUDIO_BYTES + 1024 * 1024;
const MAX_DICTATION_JSON_REQUEST_BYTES = Math.ceil(MAX_DICTATION_AUDIO_BYTES * 1.34) + 1024 * 1024;
const ALLOWED_DICTATION_AUDIO_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
  'video/webm',
]);

type DictationAudio = {
  arrayBuffer: ArrayBuffer;
  size: number;
  type: string;
};

const getErrorName = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
};

const getTranscriptionFailureStatus = (error: unknown): number => {
  if (getErrorName(error) === 'AI_NoTranscriptGeneratedError') {
    return 422;
  }
  return getGatewayStatusCode(error);
};

const getTranscriptionFailureMessage = (error: unknown): string => {
  if (getErrorName(error) === 'AI_NoTranscriptGeneratedError') {
    return 'No speech detected.';
  }
  return 'Dictation transcription failed';
};

const getNormalizedAudioType = (mediaType: string): string =>
  mediaType.split(';')[0]?.trim().toLowerCase() ?? '';

const isJsonDictationRequest = (request: Request): boolean =>
  getNormalizedAudioType(request.headers.get('content-type') ?? '').includes('application/json');

const createDictationUploadTooLargeResponse = (): Response =>
  Response.json({ error: 'Dictation upload is too large' }, { status: 413 });

const getDictationRequestSizeFailure = (request: Request): Response | null => {
  const contentLength = request.headers.get('content-length')?.trim();
  if (!contentLength) {
    return null;
  }

  const size = Number(contentLength);
  if (!Number.isFinite(size) || size < 0) {
    return null;
  }
  const maxBytes = isJsonDictationRequest(request)
    ? MAX_DICTATION_JSON_REQUEST_BYTES
    : MAX_DICTATION_MULTIPART_REQUEST_BYTES;
  if (size > maxBytes) {
    return createDictationUploadTooLargeResponse();
  }
  return null;
};

const readRequestTextWithinLimit = async (
  request: Request,
  maxBytes: number
): Promise<string | Response> => {
  const body = request.body;
  if (!body) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];

  const readNext = async (totalBytes: number): Promise<number | Response> => {
    const { done, value } = await reader.read();
    if (done) {
      return totalBytes;
    }
    if (!value) {
      return readNext(totalBytes);
    }

    const nextTotalBytes = totalBytes + value.byteLength;
    if (nextTotalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return createDictationUploadTooLargeResponse();
    }

    chunks.push(value);
    return readNext(nextTotalBytes);
  };

  const totalBytes = await readNext(0);
  if (totalBytes instanceof Response) {
    return totalBytes;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const getBase64DecodedByteLength = (base64: string): number | null => {
  if (base64.length % 4 === 1) {
    return null;
  }

  const paddingBytes = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - paddingBytes;
};

const getAudioFromJson = async (request: Request): Promise<DictationAudio | Response> => {
  let payload: { audioBase64?: unknown; mediaType?: unknown };
  try {
    const bodyText = await readRequestTextWithinLimit(request, MAX_DICTATION_JSON_REQUEST_BYTES);
    if (bodyText instanceof Response) {
      return bodyText;
    }

    const parsedPayload = JSON.parse(bodyText) as unknown;
    payload =
      parsedPayload && typeof parsedPayload === 'object'
        ? (parsedPayload as { audioBase64?: unknown; mediaType?: unknown })
        : {};
  } catch {
    return Response.json({ error: 'Invalid dictation upload' }, { status: 400 });
  }

  if (typeof payload.audioBase64 !== 'string') {
    return Response.json({ error: 'Audio file is required' }, { status: 400 });
  }
  if (typeof payload.mediaType !== 'string') {
    return Response.json({ error: 'Unsupported audio file type' }, { status: 415 });
  }

  const mediaType = getNormalizedAudioType(payload.mediaType);
  if (!mediaType || !ALLOWED_DICTATION_AUDIO_TYPES.has(mediaType)) {
    return Response.json({ error: 'Unsupported audio file type' }, { status: 415 });
  }

  const dataSeparatorIndex = payload.audioBase64.lastIndexOf(',');
  const normalizedBase64 =
    dataSeparatorIndex >= 0
      ? payload.audioBase64.slice(dataSeparatorIndex + 1).trim()
      : payload.audioBase64.trim();
  if (!normalizedBase64) {
    return Response.json({ error: 'Audio file is empty' }, { status: 400 });
  }

  const compactBase64 = normalizedBase64.replace(/\s+/gu, '');
  const decodedByteLength = getBase64DecodedByteLength(compactBase64);
  if (decodedByteLength === null) {
    return Response.json({ error: 'Invalid dictation upload' }, { status: 400 });
  }
  if (decodedByteLength > MAX_DICTATION_AUDIO_BYTES) {
    return Response.json({ error: 'Audio file is too large' }, { status: 413 });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(compactBase64);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return Response.json({ error: 'Invalid dictation upload' }, { status: 400 });
  }

  if (bytes.byteLength <= 0) {
    return Response.json({ error: 'Audio file is empty' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_DICTATION_AUDIO_BYTES) {
    return Response.json({ error: 'Audio file is too large' }, { status: 413 });
  }

  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  return {
    arrayBuffer,
    size: bytes.byteLength,
    type: mediaType,
  };
};

const getAudioFromFormData = async (request: Request): Promise<DictationAudio | Response> => {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid dictation upload' }, { status: 400 });
  }

  const audio = formData.get(DICTATION_AUDIO_FIELD);
  if (!audio || typeof audio === 'string') {
    return Response.json({ error: 'Audio file is required' }, { status: 400 });
  }
  if (audio.size <= 0) {
    return Response.json({ error: 'Audio file is empty' }, { status: 400 });
  }
  if (audio.size > MAX_DICTATION_AUDIO_BYTES) {
    return Response.json({ error: 'Audio file is too large' }, { status: 413 });
  }
  const mediaType = getNormalizedAudioType(audio.type);
  if (!mediaType || !ALLOWED_DICTATION_AUDIO_TYPES.has(mediaType)) {
    return Response.json({ error: 'Unsupported audio file type' }, { status: 415 });
  }

  return {
    arrayBuffer: await audio.arrayBuffer(),
    size: audio.size,
    type: mediaType,
  };
};

const getAudio = async (request: Request): Promise<DictationAudio | Response> =>
  isJsonDictationRequest(request) ? getAudioFromJson(request) : getAudioFromFormData(request);

const handleDictationTranscribe = async ({ request }: { request: Request }) => {
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
  const requestSizeFailure = getDictationRequestSizeFailure(request);
  if (requestSizeFailure) {
    return requestSizeFailure;
  }
  const rateLimit = await consumeVoiceRequestLimit('dictation', request);
  if (rateLimit instanceof Response) {
    return rateLimit;
  }
  if (!rateLimit.allowed) {
    return createVoiceRateLimitResponse('Dictation transcription rate limit exceeded', rateLimit);
  }

  const apiKey = getGatewayApiKey();
  if (!apiKey) {
    logger.error('Dictation transcription missing AI Gateway API key');
    return Response.json(
      { error: 'Dictation is not configured for this deployment' },
      { status: 503 }
    );
  }

  const audio = await getAudio(request);
  if (audio instanceof Response) {
    return audio;
  }

  try {
    const [{ createGateway }, { transcribe }] = await Promise.all([
      import('@ai-sdk/gateway'),
      import('ai'),
    ]);
    const gatewayModel = createGateway({ apiKey }).transcription(DICTATION_STT_MODEL_ID);
    const transcriptionModel = {
      specificationVersion: gatewayModel.specificationVersion,
      provider: gatewayModel.provider,
      modelId: gatewayModel.modelId,
      doGenerate: (options: Parameters<typeof gatewayModel.doGenerate>[0]) =>
        gatewayModel.doGenerate({ ...options, mediaType: audio.type }),
    };
    const result = await transcribe({
      model: transcriptionModel,
      audio: audio.arrayBuffer,
      maxRetries: 1,
    });

    const durationInSeconds =
      'durationInSeconds' in result && typeof result.durationInSeconds === 'number'
        ? result.durationInSeconds
        : 0;
    if (
      !(await recordCompletedVoiceUsage('dictation', request, {
        model: DICTATION_STT_MODEL_ID,
        quantity: durationInSeconds,
        unit: 'seconds',
      }))
    ) {
      logger.warn('Dictation usage tracking failed', { model: DICTATION_STT_MODEL_ID });
    }

    return Response.json(
      {
        text: result.text,
      },
      {
        headers: {
          'cache-control': 'private, no-store',
          ...voiceRateLimitHeaders(rateLimit),
        },
      }
    );
  } catch (error) {
    const status = getTranscriptionFailureStatus(error);
    logger.error('Dictation transcription failed', {
      audio: {
        size: audio.size,
        type: audio.type || undefined,
      },
      error: getGatewayErrorSummary(error),
      model: DICTATION_STT_MODEL_ID,
    });
    return Response.json({ error: getTranscriptionFailureMessage(error) }, { status });
  }
};

export const Route = createFileRoute('/api/dictation/transcribe')({
  server: {
    handlers: {
      POST: handleDictationTranscribe,
    },
  },
});
