import { ExponentialBackoff, handleAll, retry } from 'cockatiel';

import { logger } from '../logger';

const DEFAULT_RETRY_CONFIG = {
  attempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
};

const createRetryPolicy = (config: { attempts: number; baseDelayMs: number; maxDelayMs: number }) =>
  retry(handleAll, {
    maxAttempts: Math.max(config.attempts - 1, 0),
    backoff: new ExponentialBackoff({
      initialDelay: config.baseDelayMs,
      maxDelay: config.maxDelayMs,
      exponent: 2,
    }),
  });

export class DexieOperationExecutor {
  private readonly retryPolicy = createRetryPolicy(DEFAULT_RETRY_CONFIG);

  async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    try {
      const result = await this.retryPolicy.execute(() => fn());
      const duration = performance.now() - startTime;

      if (duration > 100) {
        logger.warn(`Storage slow operation: ${operation}`, {
          operation,
          durationMs: Math.round(duration),
        });
      } else {
        logger.debug(`Storage operation: ${operation}`, {
          operation,
          durationMs: Math.round(duration),
        });
      }

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error(`Storage operation failed: ${operation}`, {
        operation,
        durationMs: Math.round(duration),
        error,
      });
      throw error;
    }
  }
}
