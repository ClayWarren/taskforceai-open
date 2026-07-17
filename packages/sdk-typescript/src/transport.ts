const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
type RequestHeaders = NonNullable<RequestInit['headers']>;

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted', 'AbortError');
  }
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    const abortHandler = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
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

const parseSuccessPayload = async <T>(
  response: Response,
  externalSignal?: AbortSignal
): Promise<T> => {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TaskForceAIError(externalSignal?.aborted ? 'Request cancelled' : 'Request timeout');
    }
    throw new TaskForceAIError(
      `Unable to read response body: ${error instanceof Error ? error.message : 'Unknown error'}`,
      response.status
    );
  }

  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TaskForceAIError('Invalid JSON response from server', response.status);
  }
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

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const normalizeAbortError = (
  error: unknown,
  externalSignal?: AbortSignal
): TaskForceAIError | null => {
  if (!isAbortError(error)) {
    return null;
  }
  return new TaskForceAIError(externalSignal?.aborted ? 'Request cancelled' : 'Request timeout');
};

const waitForTransportRetry = async (
  attempt: number,
  externalSignal?: AbortSignal
): Promise<void> => {
  try {
    await sleep(retryDelayMs(attempt, null), externalSignal);
  } catch (error) {
    const abortError = normalizeAbortError(error, externalSignal);
    if (abortError) throw abortError;
    throw error;
  }
};

const shouldRetryTimeout = (
  externalSignal: AbortSignal | undefined,
  retryable: boolean,
  attempt: number,
  maxRetries: number
): boolean => !externalSignal?.aborted && retryable && attempt < maxRetries;

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
  const entries: [string, string | undefined][] =
    source instanceof Headers
      ? Array.from(source.entries())
      : Array.isArray(source)
        ? source
        : Object.entries(source);
  for (const [key, value] of entries) {
    if (value !== undefined) target.set(key, value);
  }
};

const normalizeHeaders = (
  apiKey: string,
  headers?: RequestHeaders,
  defaultContentType: string | false = 'application/json'
): Headers => {
  const normalized = new Headers({
    'x-api-key': apiKey,
    'X-SDK-Language': 'typescript',
  });
  if (defaultContentType !== false) {
    normalized.set('Content-Type', defaultContentType);
  }

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
  defaultContentType?: string | false;
}

export const makeRawRequest = async (
  endpoint: string,
  options: RequestInit,
  { apiKey, baseUrl, timeout, responseHook, defaultContentType }: TransportConfig,
  retryable = false,
  maxRetries = DEFAULT_MAX_RETRIES
): Promise<Response> => {
  const url = `${baseUrl}${endpoint}`;
  const externalSignal = options.signal ?? undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: normalizeHeaders(apiKey, options.headers, defaultContentType),
        signal: buildSignal(timeout, options.signal ?? undefined),
      });

      if (responseHook) {
        responseHook(response.clone());
      }

      if (!response.ok) {
        const errorMessage = await parseErrorMessage(response);
        const shouldRetry = retryable && isRetryableStatus(response.status) && attempt < maxRetries;
        if (shouldRetry) {
          await sleep(retryDelayMs(attempt, getRetryAfterHeader(response)), externalSignal);
          continue;
        }
        throw new TaskForceAIError(errorMessage, response.status);
      }

      return response;
    } catch (error) {
      if (error instanceof TaskForceAIError) throw error;
      const abortError = normalizeAbortError(error, externalSignal);
      if (abortError) {
        if (!shouldRetryTimeout(externalSignal, retryable, attempt, maxRetries)) {
          throw abortError;
        }
        await waitForTransportRetry(attempt, externalSignal);
        continue;
      }
      if (retryable && attempt < maxRetries) {
        await waitForTransportRetry(attempt, externalSignal);
        continue;
      }
      throw new TaskForceAIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  throw new TaskForceAIError('Request failed after maximum retries');
};

export const makeRequest = async <T>(
  endpoint: string,
  options: RequestInit,
  config: TransportConfig,
  retryable = false,
  maxRetries = DEFAULT_MAX_RETRIES
): Promise<T> =>
  parseSuccessPayload<T>(
    await makeRawRequest(endpoint, options, config, retryable, maxRetries),
    options.signal ?? undefined
  );

export const transportDefaults = {
  timeout: DEFAULT_TIMEOUT_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  backoffMs: DEFAULT_BACKOFF_MS,
  pollIntervalMs: 2_000,
  maxPollAttempts: 150,
} as const;
