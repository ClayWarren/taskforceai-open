const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
type RequestHeaders = NonNullable<RequestInit['headers']>;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });

const buildSignal = (timeoutMs: number, externalSignal?: AbortSignal): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const withHttpContext = (response: Response, detail?: string): string => {
  const base = `HTTP ${response.status}`;
  if (!detail) {
    return base;
  }
  return `${base}: ${detail}`;
};

const parseErrorMessage = async (response: Response): Promise<string> => {
  let errorText = '';
  try {
    errorText = await response.text();
  } catch {
    return withHttpContext(response);
  }

  const trimmed = errorText.trim();
  if (!trimmed) {
    return withHttpContext(response);
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        if (typeof parsed['error'] === 'string' && parsed['error'].trim()) {
          return withHttpContext(response, parsed['error']);
        }
        if (typeof parsed['message'] === 'string' && parsed['message'].trim()) {
          return withHttpContext(response, parsed['message']);
        }
      }
    } catch {
      return withHttpContext(response, trimmed);
    }
  }

  return withHttpContext(response, trimmed);
};

const parseRetryAfterMs = (headerValue: string | null): number | null => {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }

  const asSeconds = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(asSeconds)) {
    return Math.max(asSeconds * 1_000, 0);
  }

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) {
    return null;
  }
  return Math.max(asDate - Date.now(), 0);
};

const withJitter = (ms: number): number => {
  const jitterMax = Math.max(Math.floor(ms * 0.25), 1);
  return ms + Math.floor(Math.random() * jitterMax);
};

const retryDelayMs = (attempt: number, retryAfterHeader: string | null): number => {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  if (retryAfterMs !== null) {
    return withJitter(retryAfterMs);
  }

  const exponential = Math.min(DEFAULT_BACKOFF_MS * 2 ** attempt, DEFAULT_MAX_BACKOFF_MS);
  return withJitter(exponential);
};

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600);

const getRetryAfterHeader = (response: Response): string | null => {
  const headers = (response as unknown as { headers?: { get?: (name: string) => string | null } })
    .headers;
  if (!headers || typeof headers.get !== 'function') {
    return null;
  }
  return headers.get('retry-after');
};

const appendHeaders = (target: Headers, source?: RequestHeaders): void => {
  if (!source) {
    return;
  }

  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target.set(key, value);
    });
    return;
  }

  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      target.set(key, value);
    }
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target.set(key, String(value));
    }
  }
};

const normalizeHeaders = (apiKey: string, headers?: RequestHeaders): Headers => {
  const normalized = new Headers({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'X-SDK-Language': 'typescript',
  });

  appendHeaders(normalized, headers);
  return normalized;
};

export class TaskForceAIError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'TaskForceAIError';
  }
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  responseHook?: (response: Response) => void;
}

export const makeRequest = async <T>(
  endpoint: string,
  options: RequestInit,
  { apiKey, baseUrl, timeout, responseHook }: TransportConfig,
  retryable = false,
  maxRetries = DEFAULT_MAX_RETRIES
): Promise<T> => {
  const url = `${baseUrl}${endpoint}`;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: normalizeHeaders(apiKey, options.headers),
        signal: buildSignal(timeout, options.signal ?? undefined),
      });

      if (responseHook) {
        responseHook(response.clone());
      }

      if (!response.ok) {
        const errorMessage = await parseErrorMessage(response);
        const shouldRetry = retryable && isRetryableStatus(response.status) && attempt < maxRetries;
        if (shouldRetry) {
          await sleep(retryDelayMs(attempt, getRetryAfterHeader(response)));
          continue;
        }
        throw new TaskForceAIError(errorMessage, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof TaskForceAIError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TaskForceAIError('Request timeout');
      }
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw new TaskForceAIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  throw new TaskForceAIError('Request failed after maximum retries');
};

export const transportDefaults = {
  timeout: DEFAULT_TIMEOUT_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  backoffMs: DEFAULT_BACKOFF_MS,
  pollIntervalMs: 2_000,
  maxPollAttempts: 150,
} as const;
