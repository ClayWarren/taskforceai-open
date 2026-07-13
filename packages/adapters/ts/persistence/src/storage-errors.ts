import type { StorageReadError } from './storage-adapter';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const storageNotFoundError = (message: string): StorageReadError => ({
  kind: 'not_found',
  message,
});

export const storageFailureError = (error: unknown): StorageReadError => {
  if (isStorageReadError(error)) {
    return error;
  }
  return {
    kind: 'storage',
    message: error instanceof Error ? error.message : String(error),
  };
};

export const isStorageReadError = (error: unknown): error is StorageReadError => {
  if (!isRecord(error)) {
    return false;
  }
  return (
    (error['kind'] === 'not_found' || error['kind'] === 'storage') &&
    typeof error['message'] === 'string'
  );
};

export const isStorageNotFoundError = (
  error: unknown
): error is StorageReadError & { kind: 'not_found' } =>
  isStorageReadError(error) && error.kind === 'not_found';

export const storageReadErrorToError = (error: StorageReadError): Error => new Error(error.message);
