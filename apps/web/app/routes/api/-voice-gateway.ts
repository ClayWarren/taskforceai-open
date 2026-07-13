import {
  loadRootBootstrapSnapshot,
  type BootstrapRequestContext,
  type RootBootstrapSnapshot,
} from '../../lib/bootstrap/app-shell-bootstrap-snapshots';
import { resolveBootstrapOrigin } from '../../lib/bootstrap/app-shell-bootstrap-origin';

export const VOICE_API_AUTH_TIMEOUT_MS = 6_000;
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SESSION_COOKIE_NAMES = new Set(['__Secure-session_token', 'session_token']);
const VOICE_RESERVATION_PATH = '/api/v1/voice/reserve';
const VOICE_COMPLETION_PATH = '/api/v1/voice/complete';

const getCookie = (request: Request): string | null => {
  const cookie = request.headers.get('cookie')?.trim();
  return cookie && cookie.length > 0 ? cookie : null;
};

const getAuthorization = (request: Request): string | null => {
  const authorization = request.headers.get('authorization')?.trim();
  return authorization && authorization.length > 0 ? authorization : null;
};

const createBootstrapContext = (request: Request): BootstrapRequestContext => {
  const requestUrl = new URL(request.url);
  return {
    origin: resolveBootstrapOrigin(requestUrl.origin),
    authorization: getAuthorization(request),
    authTimeoutMs: VOICE_API_AUTH_TIMEOUT_MS,
    cookie: getCookie(request),
    fetchImpl: fetch,
  };
};

export type ApiRequestAuthSnapshot = RootBootstrapSnapshot['auth'];

export const getApiRequestAuthSnapshot = async (
  request: Request
): Promise<ApiRequestAuthSnapshot> => {
  const { auth } = await loadRootBootstrapSnapshot(createBootstrapContext(request));
  return auth;
};

const parseCookies = (cookieHeader: string | null): Map<string, string> => {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }
  return cookies;
};

const hasSessionCookie = (cookies: ReadonlyMap<string, string>): boolean => {
  for (const name of SESSION_COOKIE_NAMES) {
    if (cookies.has(name)) {
      return true;
    }
  }
  return false;
};

const hasBearerAuthorization = (request: Request): boolean =>
  getAuthorization(request)?.toLowerCase().startsWith('bearer ') === true;

export const validateApiRequestCsrf = (request: Request): Response | null => {
  const cookies = parseCookies(getCookie(request));
  if (!hasSessionCookie(cookies) && hasBearerAuthorization(request)) {
    return null;
  }

  const headerToken = request.headers.get(CSRF_HEADER_NAME)?.trim();
  if (!headerToken) {
    return Response.json({ error: 'CSRF token missing' }, { status: 403 });
  }

  const cookieToken = cookies.get(CSRF_COOKIE_NAME)?.trim();
  if (!cookieToken) {
    return Response.json({ error: 'CSRF cookie missing' }, { status: 403 });
  }
  if (cookieToken !== headerToken) {
    return Response.json({ error: 'CSRF token mismatch' }, { status: 403 });
  }
  return null;
};

export type VoiceRequestLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type VoiceRequestScope = 'realtime-setup' | 'speech' | 'dictation';

const isVoiceRequestLimitResult = (value: unknown): value is VoiceRequestLimitResult => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<VoiceRequestLimitResult>;
  return (
    typeof candidate.allowed === 'boolean' &&
    typeof candidate.limit === 'number' &&
    Number.isInteger(candidate.limit) &&
    candidate.limit > 0 &&
    typeof candidate.remaining === 'number' &&
    Number.isInteger(candidate.remaining) &&
    candidate.remaining >= 0 &&
    typeof candidate.resetAt === 'number' &&
    Number.isFinite(candidate.resetAt) &&
    candidate.resetAt > 0 &&
    typeof candidate.retryAfterSeconds === 'number' &&
    Number.isInteger(candidate.retryAfterSeconds) &&
    candidate.retryAfterSeconds >= 0
  );
};

const createVoiceAuthorityFailure = (status = 503): Response =>
  Response.json(
    { error: status === 401 ? 'Authentication required' : 'Voice rate limiter unavailable' },
    { status, headers: { 'cache-control': 'private, no-store' } }
  );

const createVoiceReservationHeaders = (request: Request): Headers => {
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' });
  for (const name of ['authorization', 'cookie', CSRF_HEADER_NAME, 'x-org-id']) {
    const value = request.headers.get(name)?.trim();
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
};

export const consumeVoiceRequestLimit = async (
  scope: VoiceRequestScope,
  request: Request,
  fetchImpl: typeof fetch = fetch
): Promise<VoiceRequestLimitResult | Response> => {
  const requestUrl = new URL(request.url);
  const authorityUrl = new URL(VOICE_RESERVATION_PATH, resolveBootstrapOrigin(requestUrl.origin));

  let response: Response;
  try {
    response = await fetchImpl(authorityUrl, {
      body: JSON.stringify({ operation: scope }),
      cache: 'no-store',
      headers: createVoiceReservationHeaders(request),
      method: 'POST',
      signal: AbortSignal.timeout(VOICE_API_AUTH_TIMEOUT_MS),
    });
  } catch {
    return createVoiceAuthorityFailure();
  }

  if (!response.ok) {
    return createVoiceAuthorityFailure(response.status === 401 ? 401 : 503);
  }

  try {
    const result: unknown = await response.json();
    return isVoiceRequestLimitResult(result) ? result : createVoiceAuthorityFailure();
  } catch {
    return createVoiceAuthorityFailure();
  }
};

export const recordCompletedVoiceUsage = async (
  scope: VoiceRequestScope,
  request: Request,
  usage: { model: string; quantity: number; unit: string },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> => {
  const requestUrl = new URL(request.url);
  const authorityUrl = new URL(VOICE_COMPLETION_PATH, resolveBootstrapOrigin(requestUrl.origin));
  try {
    const response = await fetchImpl(authorityUrl, {
      body: JSON.stringify({ operation: scope, ...usage }),
      cache: 'no-store',
      headers: createVoiceReservationHeaders(request),
      method: 'POST',
      signal: AbortSignal.timeout(VOICE_API_AUTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const createVoiceRateLimitResponse = (
  error: string,
  limit: VoiceRequestLimitResult
): Response =>
  Response.json(
    { error },
    {
      status: 429,
      headers: {
        'cache-control': 'private, no-store',
        'retry-after': String(limit.retryAfterSeconds),
        'x-ratelimit-limit': String(limit.limit),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1_000)),
      },
    }
  );

export const voiceRateLimitHeaders = (limit: VoiceRequestLimitResult): Record<string, string> => ({
  'x-ratelimit-limit': String(limit.limit),
  'x-ratelimit-remaining': String(limit.remaining),
  'x-ratelimit-reset': String(Math.ceil(limit.resetAt / 1_000)),
});

export const getGatewayApiKey = (): string | null => {
  const apiKey = process.env['AI_GATEWAY_API_KEY']?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : null;
};

export const getGatewayStatusCode = (error: unknown): number => {
  if (error && typeof error === 'object') {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode;
    }
  }
  return 502;
};

export const getGatewayErrorSummary = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error),
    };
  }

  const record = error as {
    generationId?: unknown;
    message?: unknown;
    name?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };

  return {
    generationId: typeof record.generationId === 'string' ? record.generationId : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    statusCode: typeof record.statusCode === 'number' ? record.statusCode : undefined,
    type: typeof record.type === 'string' ? record.type : undefined,
  };
};
