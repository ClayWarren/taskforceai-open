import { ApiClientError } from './request.error';
import {
  type CircuitBreaker,
  type MetricsCollector,
  type RequestContextOptions,
  type ResiliencePolicy,
  type TokenResult,
} from './request.types';
import {
  applyAuthorizationHeader,
  normalizeBaseUrl,
  parseErrorPayload,
  parseOptional,
  parseSuccessPayload,
} from './request.utils';
import { err } from './utils/result';

export { ApiClientError } from './request.error';
export {
  type AuthTokenPayload,
  type CircuitBreaker,
  type MetricsCollector,
  type RequestContextOptions,
  type ResiliencePolicy,
  type RetryPolicy,
  type TokenError,
  type TokenResult,
} from './request.types';
export { parseOptional } from './request.utils';

const noopMetrics: MetricsCollector = {
  incrementCounter: () => {},
  startTimer: () => () => {},
};

export type TraceContextInjector = (headers: Headers) => void;

const noopTraceContextInjector: TraceContextInjector = () => {};
let traceContextInjector: TraceContextInjector = noopTraceContextInjector;

export const configureApiTraceContextInjector = (
  injector: TraceContextInjector = noopTraceContextInjector
): void => {
  traceContextInjector = injector;
};

const defaultPolicy: ResiliencePolicy = {
  apiClient: {
    timeoutMs: 30000,
    circuitBreaker: {
      failureThreshold: 5,
      recoveryTimeMs: 30000,
    },
    retry: {
      attempts: 3,
      baseDelayMs: 1000,
      jitterMs: 100,
    },
  },
};

const defaultCircuitBreaker: CircuitBreaker = {
  execute: (fn) => fn(),
};

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

const idempotentMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

const hasIdempotencyKeyHeader = (headers: Headers): boolean => {
  const idempotencyKey = headers.get('Idempotency-Key') ?? headers.get('X-Idempotency-Key') ?? '';
  return idempotencyKey.trim().length > 0;
};

const shouldRetryRequest = (method: string, headers: Headers): boolean =>
  idempotentMethods.has(method) || hasIdempotencyKeyHeader(headers);

const isRetryableStatus = (status: number): boolean => status >= 500;

const isRetryableFetchError = (error: unknown): boolean => {
  if (error instanceof RetryableResponseError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'TimeoutError' ||
    error.name === 'TypeError' ||
    error.name === 'RetryableRequestError'
  );
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const releaseResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // Body release is best-effort; the retry path must preserve the original response error.
  }
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes('abort') || normalized.includes('timeout');
};

class RetryableResponseError extends Error {
  constructor(public readonly response: Response) {
    super(`Retryable response status ${response.status}`);
    this.name = 'RetryableResponseError';
  }
}

class RetryableRequestError extends Error {
  constructor(public readonly rootCause: unknown) {
    super('Retryable request error');
    this.name = 'RetryableRequestError';
  }
}

const computeRetryDelayMs = (
  attempt: number,
  baseDelayMs: number,
  jitterMs: number,
  maxDelayMs?: number
): number => {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const bounded = maxDelayMs !== undefined ? Math.min(exponential, maxDelayMs) : exponential;
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return bounded + jitter;
};

const defaultRetryHandler = async <T>(
  fn: () => Promise<T>,
  options: {
    attempts: number;
    baseDelayMs: number;
    jitterMs: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
  }
): Promise<T> => {
  const attempts = Math.max(1, options.attempts);
  const runAttempt = async (attempt: number): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt >= attempts) {
        throw error;
      }
      const delayMs = computeRetryDelayMs(
        attempt,
        options.baseDelayMs,
        options.jitterMs,
        options.maxDelayMs
      );
      await sleep(delayMs, options.signal);
      return runAttempt(attempt + 1);
    }
  };
  return runAttempt(1);
};

export const createRequestContext = (options: RequestContextOptions = {}) => {
  const {
    baseUrl = '',
    defaultHeaders = {},
    getToken,
    getCsrfToken,
    fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined,
    metrics = noopMetrics,
    resiliencePolicy = defaultPolicy,
    circuitBreakerFactory,
    retryHandler = defaultRetryHandler,
  } = options;

  if (!fetchImpl) {
    throw new Error('No fetch implementation provided.');
  }

  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseLabel = resolvedBaseUrl || 'relative';
  const policy = resiliencePolicy;

  const apiCircuitBreaker = circuitBreakerFactory
    ? circuitBreakerFactory(`api-client-${baseLabel}`, {
        failureThreshold: policy.apiClient.circuitBreaker.failureThreshold,
        recoveryTimeMs: policy.apiClient.circuitBreaker.recoveryTimeMs,
        labels: { baseUrl: baseLabel },
      })
    : defaultCircuitBreaker;

  const buildUrl = (path: string) => `${resolvedBaseUrl}${path}`;

  const resolveToken = async (): Promise<TokenResult> => {
    if (typeof getToken === 'function') {
      const token = getToken();
      return token instanceof Promise ? await token : token;
    }
    return err('TOKEN_MISSING');
  };

  const request = async <T = unknown>(
    path: string,
    init: RequestInit = {},
    {
      parseJson = true,
      timeoutMs: requestTimeoutMs,
    }: { parseJson?: boolean; timeoutMs?: number } = {}
  ): Promise<T> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const metricLabels = {
      baseUrl: baseLabel,
      method,
      path,
    } as const;

    const headers = new Headers(defaultHeaders);
    const initHeaders = new Headers(init.headers ?? {});
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    traceContextInjector(headers);

    await applyAuthorizationHeader(headers, metricLabels, metrics, resolveToken);

    // Apply CSRF token for state-changing methods
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && typeof getCsrfToken === 'function') {
      const csrfToken = await getCsrfToken();
      if (csrfToken && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }
    const retryableRequest = shouldRetryRequest(method, headers);

    const retryPolicy = policy.apiClient.retry;
    const maxRetryAttempts = Math.max(1, retryPolicy.attempts);
    const timeoutMs = requestTimeoutMs ?? policy.apiClient.timeoutMs ?? 30000;

    return apiCircuitBreaker.execute(async () => {
      const stopTimer = metrics.startTimer('api.client.request.duration', metricLabels);
      try {
        const retryOptions = {
          attempts: retryPolicy.attempts,
          baseDelayMs: retryPolicy.baseDelayMs,
          jitterMs: retryPolicy.jitterMs,
          ...(retryPolicy.maxDelayMs !== undefined && { maxDelayMs: retryPolicy.maxDelayMs }),
          labels: { operation: 'api.client.fetch', ...metricLabels },
          ...(init.signal ? { signal: init.signal } : {}),
        };
        let attempt = 0;
        const response = await retryHandler(async () => {
          attempt += 1;
          if (attempt > 1) {
            metrics.incrementCounter('api.client.request.retry', {
              ...metricLabels,
              attempt,
            });
          }

          const controller = new AbortController();
          const externalSignal = init.signal ?? undefined;
          const abortFromExternal = () => {
            controller.abort();
          };

          if (externalSignal) {
            if (externalSignal.aborted) {
              controller.abort();
            } else {
              externalSignal.addEventListener('abort', abortFromExternal, { once: true });
            }
          }

          const timeoutId = setTimeout(() => {
            controller.abort();
          }, timeoutMs);

          try {
            const requestInit: RequestInit = {
              ...init,
              headers,
              credentials: init.credentials ?? 'include',
              signal: controller.signal,
            };
            const fetchedResponse = await fetchImpl(buildUrl(path), requestInit);
            if (retryableRequest && isRetryableStatus(fetchedResponse.status)) {
              if (attempt < maxRetryAttempts) {
                await releaseResponseBody(fetchedResponse);
              }
              throw new RetryableResponseError(fetchedResponse);
            }
            return fetchedResponse;
          } catch (error) {
            if (error instanceof RetryableResponseError) {
              throw error;
            }
            const retryableTimeoutAbort = isAbortError(error) && !externalSignal?.aborted;
            if (retryableRequest && (isRetryableFetchError(error) || retryableTimeoutAbort)) {
              throw new RetryableRequestError(error);
            }
            throw error;
          } finally {
            clearTimeout(timeoutId);
            if (externalSignal) {
              externalSignal.removeEventListener('abort', abortFromExternal);
            }
          }
        }, retryOptions);

        metrics.incrementCounter('api.client.request.count', {
          ...metricLabels,
          status: response.status,
        });

        if (!response.ok) {
          const text = await response.text();
          const { body, message } = parseErrorPayload(response, text);

          metrics.incrementCounter('api.client.request.failure', {
            ...metricLabels,
            status: response.status,
          });
          metrics.incrementCounter('taskforceai.slo.request.failure', {
            ...metricLabels,
            status: response.status,
          });
          metrics.incrementCounter('taskforceai.slo.request.total', {
            ...metricLabels,
            outcome: 'failure',
          });

          throw new ApiClientError(response.status, body, message);
        }

        metrics.incrementCounter('api.client.request.success', metricLabels);
        metrics.incrementCounter('taskforceai.slo.request.success', metricLabels);
        metrics.incrementCounter('taskforceai.slo.request.total', {
          ...metricLabels,
          outcome: 'success',
        });
        return parseSuccessPayload<T>(response, parseJson);
      } catch (error) {
        if (error instanceof RetryableResponseError) {
          const response = error.response;
          const text = await response.text();
          const { body, message } = parseErrorPayload(response, text);
          metrics.incrementCounter('api.client.request.failure', {
            ...metricLabels,
            status: response.status,
          });
          metrics.incrementCounter('taskforceai.slo.request.failure', {
            ...metricLabels,
            status: response.status,
          });
          metrics.incrementCounter('taskforceai.slo.request.total', {
            ...metricLabels,
            outcome: 'failure',
          });
          throw new ApiClientError(response.status, body, message);
        }
        const rootError =
          error instanceof RetryableRequestError ? (error.rootCause ?? error) : error;
        const isExternallyAborted = isAbortError(rootError) && init.signal?.aborted === true;

        if (isExternallyAborted) {
          metrics.incrementCounter('api.client.request.aborted', metricLabels);
          throw rootError;
        }

        metrics.incrementCounter('api.client.request.error', {
          ...metricLabels,
          error: rootError instanceof Error ? rootError.name : 'unknown',
        });
        metrics.incrementCounter('taskforceai.slo.request.total', {
          ...metricLabels,
          outcome: 'failure',
        });
        metrics.incrementCounter('taskforceai.slo.request.failure', {
          ...metricLabels,
          status: 'network',
        });
        if (isTimeoutError(rootError)) {
          metrics.incrementCounter('taskforceai.slo.request.timeout', metricLabels);
        }
        throw rootError;
      } finally {
        stopTimer();
      }
    });
  };

  const buildJsonHeaders = (existing?: HeadersInit) => {
    const headers = new Headers(existing ?? {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  return {
    request,
    buildJsonHeaders,
    parseOptional,
    ApiClientError,
  };
};
