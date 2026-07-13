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

  const runAttempt = async (attempt: number, nextDelay: number): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attemptCount) {
        logger?.error(`${label} failed after ${attemptCount} attempts`, {
          error,
          attempts: attemptCount,
        });
        throw error;
      }
      logger?.warn?.(`${label} failed, retrying in ${nextDelay}ms`, {
        error,
        attempt,
        maxRetries: safeRetries,
      });
      await sleep(nextDelay);
      return runAttempt(attempt + 1, nextDelay * safeBackoff);
    }
  };

  return runAttempt(1, safeDelay);
};

export const debounce = <T extends (...args: any[]) => unknown>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const throttle = <T extends (...args: any[]) => unknown>(
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
