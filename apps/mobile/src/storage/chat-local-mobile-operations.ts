import { type Result, ok } from '@taskforceai/client-core/result';
import type { LoggerPort } from '@taskforceai/client-core/ports/logger';

import { dbManager } from './database-manager';
import { withRepoError, withRepoResult } from './utils';

type StorageErrorMessage = string | ((error: unknown) => string);

export const createMobileStorageOperations = (logger: LoggerPort) => {
  const reportError = (message: StorageErrorMessage, error: unknown): void => {
    const cause =
      error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: unknown }).cause
        : undefined;
    logger.error(typeof message === 'function' ? message(error) : message, {
      error,
      ...(cause ? { cause } : {}),
    });
  };

  const capture = <T>(message: StorageErrorMessage, operation: () => Promise<T>): Promise<T> =>
    withRepoError('', operation, undefined, (_label, error) => reportError(message, error));

  const run = <T>(message: StorageErrorMessage, operation: () => Promise<T>): Promise<T> =>
    capture(message, async () => {
      await dbManager.ensureOrm();
      return operation();
    });

  const runResult = <T>(
    message: StorageErrorMessage,
    operation: () => Promise<T>
  ): Promise<Result<T>> =>
    withRepoResult(
      '',
      async () => {
        await dbManager.ensureOrm();
        return ok(await operation());
      },
      undefined,
      undefined,
      (_label, error) => reportError(message, error)
    );

  return { capture, run, runResult };
};
