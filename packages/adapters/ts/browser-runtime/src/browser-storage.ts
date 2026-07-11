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

/**
 * Read a localStorage item by key.
 */
export const readStorageItem = (key: string): Result<string, StorageError> => {
  const storage = getStorage();
  if (!storage.ok) {
    return storage;
  }

  try {
    const value = storage.value.getItem(key);
    if (value === null) {
      return err({ kind: 'missing', message: 'Storage key not found.' });
    }
    return ok(value);
  } catch {
    return err({ kind: 'failed', message: 'Failed to read local storage.' });
  }
};

/**
 * Write a localStorage item.
 */
export const writeStorageItem = (key: string, value: string): Result<true, StorageError> => {
  const storage = getStorage();
  if (!storage.ok) {
    return storage;
  }

  try {
    storage.value.setItem(key, value);
    return ok(true);
  } catch {
    return err({ kind: 'failed', message: 'Failed to write local storage.' });
  }
};

/**
 * Remove a localStorage item.
 */
export const removeStorageItem = (key: string): Result<true, StorageError> => {
  const storage = getStorage();
  if (!storage.ok) {
    return storage;
  }

  try {
    storage.value.removeItem(key);
    return ok(true);
  } catch {
    return err({ kind: 'failed', message: 'Failed to remove local storage.' });
  }
};
