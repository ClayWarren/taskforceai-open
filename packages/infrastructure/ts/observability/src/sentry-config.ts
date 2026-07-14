import type { BrowserOptions } from '@sentry/react';
import { createGraphTransformer } from './internal/graph-transform';
import { isSensitiveSentryKey, sanitizeSentryString } from './sentry-sanitize';

type ServerOptions = Omit<BrowserOptions, 'replaysOnErrorSampleRate' | 'replaysSessionSampleRate'>;
type EdgeOptions = ServerOptions;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

type BeforeSend = NonNullable<BrowserOptions['beforeSend']>;
type BeforeSendEvent = Parameters<BeforeSend>[0];

const createScrubber = () =>
  createGraphTransformer({
    leaf: (value) => (typeof value === 'string' ? sanitizeSentryString(value) : value),
    redact: (key) => (isSensitiveSentryKey(key) ? '[Filtered]' : undefined),
  });

const scrub = (value: unknown): unknown => createScrubber()(value);

const sanitizeSearchParams = (params: URLSearchParams): URLSearchParams => {
  const sanitized = new URLSearchParams();
  params.forEach((value, key) => {
    sanitized.append(key, isSensitiveSentryKey(key) ? '[Filtered]' : sanitizeSentryString(value));
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

const sanitizeHash = (value: string): string => {
  if (!value) {
    return '';
  }

  const body = value.startsWith('#') ? value.slice(1) : value;
  if (!body) {
    return '#';
  }

  const queryStart = body.indexOf('?');
  if (queryStart !== -1) {
    const prefix = body.slice(0, queryStart);
    const query = body.slice(queryStart + 1);
    return `#${sanitizeSentryString(prefix)}?${sanitizeSearchParams(
      new URLSearchParams(query)
    ).toString()}`;
  }

  if (body.includes('=')) {
    return `#${sanitizeSearchParams(new URLSearchParams(body)).toString()}`;
  }

  return `#${sanitizeSentryString(body)}`;
};

const sanitizeUrlText = (value: string): string => {
  const hashStart = value.indexOf('#');
  const beforeHash = hashStart === -1 ? value : value.slice(0, hashStart);
  const hash = hashStart === -1 ? '' : value.slice(hashStart);
  const queryStart = beforeHash.indexOf('?');
  if (queryStart === -1) {
    return `${sanitizeSentryString(beforeHash)}${sanitizeHash(hash)}`;
  }

  const prefix = beforeHash.slice(0, queryStart);
  const query = beforeHash.slice(queryStart + 1);
  const sanitizedQuery = sanitizeSearchParams(new URLSearchParams(query)).toString();

  return `${sanitizeSentryString(prefix)}?${sanitizedQuery}${sanitizeHash(hash)}`;
};

const sanitizeUrl = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return scrub(value);
  }

  const isAbsolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
  const isProtocolRelative = value.startsWith('//');
  if (!isAbsolute && !isProtocolRelative) {
    return sanitizeUrlText(value);
  }

  try {
    const url = new URL(value, 'https://taskforceai.local');
    url.pathname = sanitizeSentryString(url.pathname);
    url.search = sanitizeSearchParams(url.searchParams).toString();
    url.hash = sanitizeHash(url.hash);
    if (isProtocolRelative) {
      return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return sanitizeUrlText(value);
  }
};

const sanitizeRequest = (request: Record<string, unknown>): string | undefined => {
  let correlationId: string | undefined;
  const headers = request['headers'];
  if (isRecord(headers)) {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (isSensitiveSentryKey(lowerKey)) {
        sanitized[key] = '[Filtered]';
        continue;
      }
      const normalized = Array.isArray(value) ? value.join(', ') : String(value);
      sanitized[key] = sanitizeSentryString(normalized);
      if (lowerKey === 'x-correlation-id') correlationId = sanitized[key];
    }
    request['headers'] = sanitized;
  }
  if ('url' in request) request['url'] = sanitizeUrl(request['url']);
  if ('query_string' in request)
    request['query_string'] = sanitizeQueryString(request['query_string']);
  if ('cookies' in request) request['cookies'] = '[Filtered]';
  return correlationId;
};

const sanitizeBreadcrumbs = (
  breadcrumbs: unknown,
  scrubValue: (value: unknown) => unknown
): void => {
  if (!Array.isArray(breadcrumbs)) return;
  for (const breadcrumb of breadcrumbs) {
    if (!isRecord(breadcrumb)) continue;
    const data = breadcrumb['data'];
    breadcrumb['data'] = scrubValue(isRecord(data) ? data : (data ?? {}));
    if (typeof breadcrumb['message'] === 'string') {
      breadcrumb['message'] = sanitizeSentryString(breadcrumb['message']);
    }
  }
};

const assignScrubbedEventField = (
  event: UnknownRecord,
  key: string,
  scrubValue: (value: unknown) => unknown
): void => {
  if (!(key in event)) return;
  const scrubbed = scrubValue(event[key]);
  if (scrubbed !== undefined) {
    event[key] = scrubbed;
  }
};

const sanitizeUser = (event: UnknownRecord, scrubValue: (value: unknown) => unknown): void => {
  const scrubbed = scrubValue(event['user']);
  if (!isRecord(scrubbed)) {
    if (scrubbed !== undefined) event['user'] = scrubbed;
    return;
  }

  if ('email' in scrubbed) scrubbed['email'] = '[Filtered]';
  if ('ip_address' in scrubbed) scrubbed['ip_address'] = '[Filtered]';
  event['user'] = scrubbed;
};

export function sanitizeEvent(event: BeforeSendEvent): BeforeSendEvent {
  if (!isRecord(event)) {
    return event;
  }

  const request = event['request'];
  const correlationId = isRecord(request) ? sanitizeRequest(request) : undefined;

  if (correlationId) {
    const tags = isRecord(event['tags']) ? event['tags'] : {};
    const contexts = isRecord(event['contexts']) ? event['contexts'] : {};
    event['tags'] = { ...tags, correlation_id: correlationId };
    event['contexts'] = { ...contexts, correlation: { id: correlationId } };
  }

  const scrubValue = createScrubber();
  if (typeof event['message'] === 'string') {
    event['message'] = sanitizeSentryString(event['message']);
  }
  assignScrubbedEventField(event, 'exception', scrubValue);
  sanitizeUser(event, scrubValue);
  assignScrubbedEventField(event, 'tags', scrubValue);
  assignScrubbedEventField(event, 'fingerprint', scrubValue);
  if (isRecord(request)) {
    request['data'] = scrubValue(request['data']);
  }
  if (event['extra']) {
    const scrubbedExtra = scrubValue(event['extra']);
    if (scrubbedExtra !== undefined) {
      event['extra'] = scrubbedExtra as NonNullable<(typeof event)['extra']>;
    }
  }
  if (event['contexts']) {
    const scrubbedContexts = scrubValue(event['contexts']);
    if (scrubbedContexts !== undefined) {
      event['contexts'] = scrubbedContexts as NonNullable<(typeof event)['contexts']>;
    }
  }

  sanitizeBreadcrumbs(event['breadcrumbs'], scrubValue);

  return event;
}

type EnvSource = Record<string, string | undefined>;
type StaticImportMetaEnv = {
  readonly MODE?: string;
  readonly NODE_ENV?: string;
  readonly VERCEL_ENV?: string;
  readonly NEXT_PUBLIC_SENTRY_DSN?: string;
  readonly NEXT_PUBLIC_SENTRY_DEBUG?: string;
  readonly NEXT_PUBLIC_SENTRY_DISABLED?: string;
  readonly NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
  readonly NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE?: string;
  readonly NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE?: string;
  readonly NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_DEBUG?: string;
  readonly VITE_SENTRY_DISABLED?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_PROFILES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE?: string;
};

type ImportMetaWithEnv = ImportMeta & { readonly env?: StaticImportMetaEnv };

const normalizeEnvValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  // coverage-ignore-start -- import.meta.env coerces assigned values to strings under Bun.
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // coverage-ignore-end
  return undefined;
};

const getImportMetaEnvSource = (): EnvSource => {
  const meta = import.meta as ImportMetaWithEnv;
  if (!meta.env) {
    return {}; // coverage-ignore-line -- Bun always provides import.meta.env for imported modules.
  }

  return {
    MODE: normalizeEnvValue(((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).MODE),
    NODE_ENV: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).NODE_ENV
    ),
    VERCEL_ENV: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VERCEL_ENV
    ),
    NEXT_PUBLIC_SENTRY_DSN: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).NEXT_PUBLIC_SENTRY_DSN
    ),
    NEXT_PUBLIC_SENTRY_DEBUG: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).NEXT_PUBLIC_SENTRY_DEBUG
    ),
    NEXT_PUBLIC_SENTRY_DISABLED: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).NEXT_PUBLIC_SENTRY_DISABLED
    ),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).NEXT_PUBLIC_SENTRY_ENVIRONMENT
    ),
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
    ),
    NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE
    ),
    NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
    ),
    NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
    ),
    VITE_SENTRY_DSN: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VITE_SENTRY_DSN
    ),
    VITE_SENTRY_DEBUG: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VITE_SENTRY_DEBUG
    ),
    VITE_SENTRY_DISABLED: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VITE_SENTRY_DISABLED
    ),
    VITE_SENTRY_ENVIRONMENT: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VITE_SENTRY_ENVIRONMENT
    ),
    VITE_SENTRY_TRACES_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv).VITE_SENTRY_TRACES_SAMPLE_RATE
    ),
    VITE_SENTRY_PROFILES_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .VITE_SENTRY_PROFILES_SAMPLE_RATE
    ),
    VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
    ),
    VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: normalizeEnvValue(
      ((import.meta as ImportMetaWithEnv).env as StaticImportMetaEnv)
        .VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
    ),
  };
};

const getProcessEnvSource = (): EnvSource =>
  typeof process !== 'undefined' ? (process.env as EnvSource) : {};

const getEnvSource = (): EnvSource => ({
  ...getImportMetaEnvSource(),
  ...getProcessEnvSource(),
});

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
  return pickEnvValue(
    [src[`NEXT_PUBLIC_SENTRY_${key}`], src[`VITE_SENTRY_${key}`], src[`SENTRY_${key}`]],
    fallback
  );
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
    environment: readEnv(
      'ENVIRONMENT',
      src['VERCEL_ENV'] || src['NODE_ENV'] || src['MODE'] || 'development'
    ),
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

export const createServerOptions = (): ServerOptions =>
  ({
    ...buildOptions(
      readServerEnv,
      readServerEnv('DSN', '') || undefined,
      readServerEnv('DEBUG', '0') === '1'
    ),
  }) satisfies ServerOptions;

export const createEdgeOptions = (): EdgeOptions => createServerOptions();
