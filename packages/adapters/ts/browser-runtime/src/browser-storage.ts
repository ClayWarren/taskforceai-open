import { type Result, err, ok } from '@taskforceai/client-core/result';

export type StorageError = {
  kind: 'unavailable' | 'missing' | 'failed';
  message: string;
};

const getStorage = (): Result<Storage, StorageError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Local storage unavailable.' });
  }
  try {
    if (!window.localStorage) {
      return err({ kind: 'unavailable', message: 'Local storage unavailable.' });
    }
    return ok(window.localStorage);
  } catch {
    return err({ kind: 'unavailable', message: 'Local storage unavailable.' });
  }
};

const accessStorage = <T>(
  failureMessage: string,
  action: (storage: Storage) => Result<T, StorageError>
): Result<T, StorageError> => {
  const storage = getStorage();
  if (!storage.ok) return storage;
  try {
    return action(storage.value);
  } catch {
    return err({ kind: 'failed', message: failureMessage });
  }
};

/**
 * Read a localStorage item by key.
 */
export const readStorageItem = (key: string): Result<string, StorageError> => {
  return accessStorage('Failed to read local storage.', (storage) => {
    const value = storage.getItem(key);
    if (value === null) {
      return err({ kind: 'missing', message: 'Storage key not found.' });
    }
    return ok(value);
  });
};

/**
 * Write a localStorage item.
 */
export const writeStorageItem = (key: string, value: string): Result<true, StorageError> => {
  return accessStorage('Failed to write local storage.', (storage) => {
    storage.setItem(key, value);
    return ok(true);
  });
};

/**
 * Remove a localStorage item.
 */
export const removeStorageItem = (key: string): Result<true, StorageError> => {
  return accessStorage('Failed to remove local storage.', (storage) => {
    storage.removeItem(key);
    return ok(true);
  });
};
