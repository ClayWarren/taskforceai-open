import { describe, it, expect, beforeEach } from 'bun:test';
import { readStorageItem, writeStorageItem, removeStorageItem } from './browser-storage';
import '../../../../../tests/setup/dom';

describe('browser-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes and reads items correctly', () => {
    const key = 'test-key';
    const value = 'test-value';

    const writeResult = writeStorageItem(key, value);
    expect(writeResult.ok).toBe(true);

    const readResult = readStorageItem(key);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value).toBe(value);
    }
  });

  it('returns missing error for non-existent keys', () => {
    const result = readStorageItem('non-existent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing');
    }
  });

  it('removes items correctly', () => {
    const key = 'remove-me';
    writeStorageItem(key, 'value');

    const removeResult = removeStorageItem(key);
    expect(removeResult.ok).toBe(true);

    const readResult = readStorageItem(key);
    expect(readResult.ok).toBe(false);
  });
});
