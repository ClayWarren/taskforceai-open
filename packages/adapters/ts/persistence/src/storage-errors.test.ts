import { describe, expect, it } from 'bun:test';

import {
  isStorageNotFoundError,
  storageFailureError,
  storageNotFoundError,
  storageReadErrorToError,
} from './storage-errors';

describe('storage-errors', () => {
  it('preserves existing storage read errors', () => {
    const notFound = storageNotFoundError('missing');

    expect(storageFailureError(notFound)).toBe(notFound);
    expect(isStorageNotFoundError(notFound)).toBe(true);
    expect(storageReadErrorToError(notFound)).toEqual(new Error('missing'));
  });
});
