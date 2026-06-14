import type { BrowserOptions, EdgeOptions, NodeOptions } from '@sentry/nextjs';
import { sanitizeValue } from '@taskforceai/shared/logging/sanitize';

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

type BeforeSend = NonNullable<BrowserOptions['beforeSend']>;
type BeforeSendEvent = Parameters<BeforeSend>[0];

const SENSITIVE = new Set([
  'authorization',
  'x-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-vercel-ai-key',
  'vercel-ai-key',
  'vercel_ai_api_key',
  'vercelaikey',
  'api_key',
  'apikey',
  'vercelaikey',
  'vercel_ai_key',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'client_secret',
  'stripe_secret_key',
]);

const isSensitiveKey = (key: string) => {
  const lowerKey = key.toLowerCase();
  return (
    SENSITIVE.has(lowerKey) ||
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('api-key') ||
    lowerKey.includes('authorization') ||
    lowerKey.includes('password') ||
    lowerKey.includes('session') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('token')
  );
};

const scrubString = (value: string): string => String(sanitizeValue(value));

type ScrubState = {
  active: WeakSet<object>;
  memo: WeakMap<object, unknown>;
};

const createScrubState = (): ScrubState => ({
  active: new WeakSet<object>(),
  memo: new WeakMap<object, unknown>(),
});

const scrub = (value: unknown, state: ScrubState = createScrubState()): unknown => {
  if (Array.isArray(value)) {
    if (state.active.has(value)) {
      return '[Circular]';
    }
    const cached = state.memo.get(value);
    if (cached !== undefined) {
      return cached;
    }

    const sanitized: unknown[] = [];
    state.memo.set(value, sanitized);
    state.active.add(value);
    for (const item of value) {
      sanitized.push(scrub(item, state));
    }
    state.active.delete(value);
    return sanitized;
  }

  if (isRecord(value)) {
    if (state.active.has(value)) {
      return '[Circular]';
    }
    const cached = state.memo.get(value);
    if (cached !== undefined) {
      return cached;
    }

    const sanitized: UnknownRecord = {};
    state.memo.set(value, sanitized);
    state.active.add(value);
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = isSensitiveKey(key) ? '[Filtered]' : scrub(val, state);
    }
    state.active.delete(value);
    return sanitized;
  }

  return value;
};

const sanitizeSearchParams = (params: URLSearchParams): URLSearchParams => {
  const sanitized = new URLSearchParams();
  params.forEach((value, key) => {
    sanitized.append(key, isSensitiveKey(key) ? '[Filtered]' : scrubString(value));
  });
  return sanitized;
};

const sanitizeQueryString = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return scrub(value);
  }
  const prefixed = value.startsWith('?');
  const params = sanitizeSearchParams(new URLSearchParams(prefixed ? value.slice(1) : value));
  const serialized = params.toString();
  return prefixed && serialized ? `?${serialized}` : serialized;
};

const sanitizeMalformedUrl = (value: string): string => {
  const queryStart = value.indexOf('?');
  if (queryStart === -1) {
    return scrubString(value);
  }

  const prefix = value.slice(0, queryStart);
  const rest = value.slice(queryStart + 1);
  const hashStart = rest.indexOf('#');
  const query = hashStart === -1 ? rest : rest.slice(0, hashStart);
  const hash = hashStart === -1 ? '' : rest.slice(hashStart);
  const sanitizedQuery = sanitizeSearchParams(new URLSearchParams(query)).toString();

  return `${scrubString(prefix)}?${sanitizedQuery}${scrubString(hash)}`;
};

const sanitizeUrl = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return scrub(value);
  }

  try {
    const isRelative = value.startsWith('/');
    const url = new URL(value, 'https://taskforceai.local');
    url.search = sanitizeSearchParams(url.searchParams).toString();
    if (isRelative) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return sanitizeMalformedUrl(value);
  }
};

export function sanitizeEvent(event: BeforeSendEvent): BeforeSendEvent {
  if (!isRecord(event)) {
    return event;
  }

  let correlationId: string | undefined;
  const request = event['request'];
  if (isRecord(request)) {
    const headers = request['headers'];
    if (isRecord(headers)) {
      const sanitized: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (isSensitiveKey(lowerKey)) {
          sanitized[key] = '[Filtered]';
        } else {
          const normalized = Array.isArray(value) ? value.join(', ') : String(value);
          sanitized[key] = scrubString(normalized);
          if (lowerKey === 'x-correlation-id') {
            correlationId = sanitized[key];
          }
        }
      }
      request['headers'] = sanitized;
    }
    if ('url' in request) {
      request['url'] = sanitizeUrl(request['url']);
    }
    if ('query_string' in request) {
      request['query_string'] = sanitizeQueryString(request['query_string']);
    }
    if ('cookies' in request) {
      request['cookies'] = '[Filtered]';
    }
  }

  if (correlationId) {
    const tags = isRecord(event['tags']) ? event['tags'] : {};
    const contexts = isRecord(event['contexts']) ? event['contexts'] : {};
    event['tags'] = { ...tags, correlation_id: correlationId };
    event['contexts'] = { ...contexts, correlation: { id: correlationId } };
  }

  (['request.data', 'extra', 'contexts'] as const).forEach((path) => {
    const [root, nested] = path.split('.');
    if (!root) {
      return;
    }
    const target = event[root];
    if (!target) {
      return;
    }
    if (!nested) {
      event[root] = scrub(target);
      return;
    }
    if (isRecord(target)) {
      target[nested] = scrub(target[nested]);
    }
  });

  const breadcrumbs = event['breadcrumbs'];
  if (Array.isArray(breadcrumbs)) {
    event['breadcrumbs'] = breadcrumbs.map((breadcrumb) => {
      if (!isRecord(breadcrumb)) {
        return breadcrumb;
      }
      const data = breadcrumb['data'];
      const normalizedData = isRecord(data) ? data : (data ?? {});
      breadcrumb['data'] = scrub(normalizedData);
      return breadcrumb;
    });
  }

  return event;
}

const getEnvSource = (): Record<string, string | undefined> =>
  typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : {};

const pickEnvValue = (values: Array<string | undefined>, fallback: string) => {
  for (const value of values) {
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return fallback;
};

type EnvReader = (key: string, fallback?: string) => string;

const readBrowserEnv: EnvReader = (key, fallback = '0') => {
  const src = getEnvSource();
  return pickEnvValue([src[`NEXT_PUBLIC_SENTRY_${key}`], src[`SENTRY_${key}`]], fallback);
};

const readServerEnv: EnvReader = (key, fallback = '0') => {
  const src = getEnvSource();
  return pickEnvValue([src[`SENTRY_${key}`], src[`NEXT_PUBLIC_SENTRY_${key}`]], fallback);
};

const parseRatio = (value: string, fallback: number) => {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
};

const buildOptions = (readEnv: EnvReader, dsn: string | undefined, debug = false) => {
  const src = getEnvSource();
  const options = {
    debug,
    enabled: !!dsn && readEnv('DISABLED', '0') !== '1',
    environment: readEnv('ENVIRONMENT', src['VERCEL_ENV'] || src['NODE_ENV'] || 'development'),
    sendDefaultPii: false,
    beforeSend: sanitizeEvent,
    ignoreErrors: ['AbortError', 'Load failed', 'ResizeObserver loop limit exceeded'],
    ...(dsn ? { dsn } : {}),
  };
  return options;
};

export const createBrowserOptions = (): BrowserOptions => {
  const dsn = readBrowserEnv('DSN', '');
  const debug = readBrowserEnv('DEBUG', '0') === '1';
  const options = {
    ...buildOptions(readBrowserEnv, dsn || undefined, debug),
    tracesSampleRate: parseRatio(readBrowserEnv('TRACES_SAMPLE_RATE', '0'), 0),
    profilesSampleRate: parseRatio(readBrowserEnv('PROFILES_SAMPLE_RATE', '0'), 0),
    replaysSessionSampleRate: parseRatio(readBrowserEnv('REPLAYS_SESSION_SAMPLE_RATE', '0'), 0),
    replaysOnErrorSampleRate: parseRatio(readBrowserEnv('REPLAYS_ON_ERROR_SAMPLE_RATE', '1'), 1),
  } satisfies BrowserOptions;
  return options;
};

export const createServerOptions = (): NodeOptions =>
  ({
    ...buildOptions(
      readServerEnv,
      readServerEnv('DSN', '') || undefined,
      readServerEnv('DEBUG', '0') === '1'
    ),
  }) satisfies NodeOptions;

export const createEdgeOptions = (): EdgeOptions =>
  ({
    ...buildOptions(
      readServerEnv,
      readServerEnv('DSN', '') || undefined,
      readServerEnv('DEBUG', '0') === '1'
    ),
  }) satisfies EdgeOptions;
