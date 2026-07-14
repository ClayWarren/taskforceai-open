import { readStatusCode } from '@taskforceai/api-client/api/response';

const UNAUTHORIZED_STATUS_CODE = 401;
const UNPROCESSABLE_STATUS_CODE = 422;

export class SyncUnauthorizedError extends Error {
  readonly status = UNAUTHORIZED_STATUS_CODE;

  constructor(cause?: unknown) {
    super('Sync request unauthorized', cause ? { cause } : undefined);
    this.name = 'SyncUnauthorizedError';
  }
}

export const toSyncManagerError = (error: unknown): Error => {
  if (readStatusCode(error) === UNAUTHORIZED_STATUS_CODE) {
    return error instanceof SyncUnauthorizedError ? error : new SyncUnauthorizedError(error);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error('Sync manager failed', { cause: error });
};

export const isSyncUnauthorizedError = (error: Error): error is SyncUnauthorizedError =>
  error instanceof SyncUnauthorizedError;

export const isUnprocessableSyncError = (error: unknown): boolean =>
  readStatusCode(error) === UNPROCESSABLE_STATUS_CODE;

export const generateRecoveredDeviceId = (): string =>
  `web-recovered-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
