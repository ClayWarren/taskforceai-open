/**
 * Error classification and retry logic shared across platforms
 */

export interface DetailedError {
  status?: number;
  message?: string;
  name?: string;
  body?: unknown;
}

const parseNumericString = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toEpochMs = (value: number): number => (value < 1e12 ? value * 1000 : value);

const parseResetTimeEpochMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return toEpochMs(value);
  }
  if (typeof value === 'string') {
    const numeric = parseNumericString(value);
    if (numeric !== null) {
      return toEpochMs(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseRetryAfterDelayMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value * 1000;
  }
  if (typeof value === 'string') {
    const numeric = parseNumericString(value);
    if (numeric !== null) {
      return numeric * 1000;
    }
    const epochMs = parseResetTimeEpochMs(value);
    if (epochMs !== null) {
      return Math.max(0, epochMs - Date.now());
    }
  }
  return null;
};

/**
 * Determines if an error is transient and should be retried.
 *
 * Returns:
 * - true: retryable immediately (with standard backoff)
 * - number: retryable after specific delay (ms)
 * - false: not retryable (permanent failure)
 */
export const isRetryableError = (error: unknown): boolean | number => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as DetailedError;
  const status = typeof err.status === 'number' ? err.status : null;

  // 1. Rate Limiting (429)
  if (status === 429) {
    const errorBody =
      typeof err.body === 'object' && err.body !== null
        ? (err.body as Record<string, unknown>)
        : {};
    const resetTimeMs = parseResetTimeEpochMs(errorBody['resetTime']);
    const retryAfterDelay = parseRetryAfterDelayMs(errorBody['retry_after']);
    const delay =
      resetTimeMs !== null
        ? Math.max(0, resetTimeMs - Date.now())
        : retryAfterDelay !== null
          ? retryAfterDelay
          : null;
    // Only return explicit delay if it's within reasonable bounds (e.g., < 1 minute)
    if (typeof delay === 'number' && delay > 0 && delay < 60000) return delay;
    return true; // Generic retryable 429
  }

  // 2. Server Errors (5xx)
  if (status !== null && status >= 500) {
    return true;
  }

  // 3. Network & Connectivity Issues
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  const name = typeof err.name === 'string' ? err.name.toLowerCase() : '';

  const retryableKeywords = [
    'network',
    'timeout',
    'temporarily',
    'unavailable',
    'abort',
    'fetch failed',
    'connection',
    'socket',
  ];

  if (retryableKeywords.some((keyword) => message.includes(keyword) || name.includes(keyword))) {
    return true;
  }

  return false;
};
