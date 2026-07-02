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
const VOICE_REQUEST_LIMIT_PRUNE_THRESHOLD = 1_000;

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

export const isApiRequestAuthenticated = async (request: Request): Promise<boolean> => {
  const auth = await getApiRequestAuthSnapshot(request);
  return auth?.isAuthenticated === true;
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

type VoiceRequestLimitEntry = {
  count: number;
  resetAt: number;
};

export type VoiceRequestLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type VoiceRequestLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

const voiceRequestLimits = new Map<string, VoiceRequestLimitEntry>();

const getClientIp = (request: Request): string => {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor && forwardedFor.length > 0 ? forwardedFor : 'unknown';
};

const getVoiceActorKey = (request: Request, auth: ApiRequestAuthSnapshot): string => {
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

const pruneExpiredVoiceRequestLimits = (now: number) => {
  if (voiceRequestLimits.size < VOICE_REQUEST_LIMIT_PRUNE_THRESHOLD) {
    return;
  }

  for (const [key, entry] of voiceRequestLimits) {
    if (entry.resetAt <= now) {
      voiceRequestLimits.delete(key);
    }
  }
};

export const consumeVoiceRequestLimit = (
  scope: string,
  request: Request,
  auth: ApiRequestAuthSnapshot,
  options: VoiceRequestLimitOptions,
  now = Date.now()
): VoiceRequestLimitResult => {
  pruneExpiredVoiceRequestLimits(now);

  const key = `${scope}:${getVoiceActorKey(request, auth)}`;
  const current = voiceRequestLimits.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + options.windowMs;
    voiceRequestLimits.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: options.maxRequests,
      remaining: options.maxRequests - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= options.maxRequests) {
    return {
      allowed: false,
      limit: options.maxRequests,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    limit: options.maxRequests,
    remaining: options.maxRequests - current.count,
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  };
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

export const resetVoiceRequestLimitsForTests = () => {
  voiceRequestLimits.clear();
};

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
