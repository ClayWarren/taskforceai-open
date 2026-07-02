import { IterableBackoff, handleAll, retry as cockatielRetry } from 'cockatiel';

export function sleep(ms: number): Promise<void> {
  // Use portable setTimeout instead of Bun.sleep for cross-platform compatibility
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type LoggerLike = Readonly<{
  info?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}>;

export const retry = async <T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoff?: number;
    logger?: LoggerLike;
    label?: string;
  } = {}
): Promise<T> => {
  const { retries = 3, delay = 1000, backoff = 2, logger, label = 'Operation' } = options;
  const safeRetries = Math.max(0, Number.isFinite(retries) ? Math.floor(retries) : 3);
  const attemptCount = safeRetries + 1;
  const safeDelay = Math.max(0, Number.isFinite(delay) ? delay : 1000);
  const safeBackoff = Math.max(1, Number.isFinite(backoff) ? backoff : 2);

  const delays: number[] = [];
  let wait = safeDelay;
  for (let attempt = 0; attempt < safeRetries; attempt += 1) {
    delays.push(wait);
    wait *= safeBackoff;
  }

  const policy = cockatielRetry(handleAll, {
    maxAttempts: safeRetries,
    backoff: new IterableBackoff(delays),
  });
  policy.onRetry((event) => {
    const reason = 'error' in event ? event.error : event.value;
    logger?.warn?.(`${label} failed, retrying in ${event.delay}ms`, {
      error: reason,
      attempt: event.attempt,
      maxRetries: safeRetries,
    });
  });

  try {
    return await policy.execute(fn);
  } catch (error) {
    logger?.error(`${label} failed after ${attemptCount} attempts`, {
      error,
      attempts: attemptCount,
    });
    throw error;
  }
};

export const debounce = <T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const throttle = <T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

/**
 * Track a fire-and-forget promise and log if it fails.
 */
export const trackPromise = <T>(
  promise: Promise<T>,
  options: { logger: LoggerLike; label: string }
): void => {
  void promise.catch((error: unknown) => {
    options.logger.error(`${options.label} failed`, { error });
  });
};
