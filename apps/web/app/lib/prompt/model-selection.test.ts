import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { type Result, ok } from '@taskforceai/client-core/result';
import type { StorageError } from '@taskforceai/browser-runtime/browser-storage';

const mockReadStorageItem = mock<() => Result<string, StorageError>>(() => ok(''));
const mockWriteStorageItem = mock<() => Result<true, StorageError>>(() => ok(true));
const mockRemoveStorageItem = mock<() => Result<true, StorageError>>(() => ok(true));

mock.module('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: mockReadStorageItem,
  writeStorageItem: mockWriteStorageItem,
  removeStorageItem: mockRemoveStorageItem,
}));

import {
  MODEL_SELECTION_STORAGE_KEY,
  persistModelSelection,
  readStoredModelSelection,
} from './model-selection';

describe('model-selection browser facade', () => {
  beforeEach(() => {
    mockReadStorageItem.mockClear();
    mockWriteStorageItem.mockClear();
    mockRemoveStorageItem.mockClear();
    mockReadStorageItem.mockImplementation(() => ok(''));
  });

  it('reads from the stable browser storage key and maps storage errors to null', () => {
    mockReadStorageItem.mockReturnValue(ok(JSON.stringify({ id: 'gpt-4', label: 'GPT-4' })));
    expect(readStoredModelSelection()).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    expect(MODEL_SELECTION_STORAGE_KEY).toBe('taskforceai:model-selection');
    expect(mockReadStorageItem).toHaveBeenCalledWith(MODEL_SELECTION_STORAGE_KEY);

    mockReadStorageItem.mockReturnValue({
      ok: false,
      error: { kind: 'missing', message: 'Storage key not found.' },
    });
    expect(readStoredModelSelection()).toBeNull();
  });

  it('writes selections through browser storage', () => {
    const selection = { id: 'gpt-4', label: 'GPT-4' };
    persistModelSelection(selection);

    expect(mockWriteStorageItem).toHaveBeenCalledWith(
      MODEL_SELECTION_STORAGE_KEY,
      JSON.stringify(selection)
    );
    expect(mockRemoveStorageItem).not.toHaveBeenCalled();
  });

  it('removes the browser storage key for a null selection', () => {
    persistModelSelection(null);

    expect(mockRemoveStorageItem).toHaveBeenCalledWith(MODEL_SELECTION_STORAGE_KEY);
    expect(mockWriteStorageItem).not.toHaveBeenCalled();
  });
});
