import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { type Result, ok } from '@taskforceai/client-core/result';
import type { StorageError } from '@taskforceai/browser-runtime/browser-storage';

// Mock browser-storage
const mockReadStorageItem = mock<() => Result<string, StorageError>>(() => ok(''));
const mockWriteStorageItem = mock<() => Result<true, StorageError>>(() => ok(true));
const mockRemoveStorageItem = mock<() => Result<true, StorageError>>(() => ok(true));

mock.module('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: mockReadStorageItem,
  writeStorageItem: mockWriteStorageItem,
  removeStorageItem: mockRemoveStorageItem,
}));

import { deriveSelectionFromOptions, formatUsageMultiple } from '@taskforceai/client-core';
import {
  MODEL_SELECTION_STORAGE_KEY,
  persistModelSelection,
  readStoredModelSelection,
} from './model-selection';

describe('model-selection', () => {
  beforeEach(() => {
    mockReadStorageItem.mockClear();
    mockWriteStorageItem.mockClear();
    mockRemoveStorageItem.mockClear();
    // Default mock implementation
    mockReadStorageItem.mockImplementation(() => ok(''));
  });

  describe('readStoredModelSelection', () => {
    it('returns null when no selection stored', () => {
      mockReadStorageItem.mockReturnValue(ok(''));
      // The implementation checks if readStorageItem returns error, or if value is null?
      // Actually readStorageItem returns Result<string, ...>.
      // The implementation:
      // const rawResult = readStorageItem(...)
      // if (!rawResult.ok) return null
      // const raw = rawResult.value (string)
      // So if storage item is missing, readStorageItem should probably return err({kind:'missing'})
      // or check how readStoredModelSelection handles missing.
      //
      // In browser-storage.ts: if (value === null) return err({ kind: 'missing' ... })
      // So let's simulate that.
      mockReadStorageItem.mockReturnValue({
        ok: false,
        error: { kind: 'missing', message: 'Storage key not found.' },
      });

      expect(readStoredModelSelection()).toBeNull();
    });

    it('parses stored object selection', () => {
      mockReadStorageItem.mockReturnValue(ok(JSON.stringify({ id: 'gpt-4', label: 'GPT-4' })));
      const result = readStoredModelSelection();
      expect(result).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    });

    it('parses stored string selection (legacy format)', () => {
      mockReadStorageItem.mockReturnValue(ok(JSON.stringify('claude-3')));
      const result = readStoredModelSelection();
      expect(result).toEqual({ id: 'claude-3', label: null });
    });

    it('handles invalid JSON by treating as plain string', () => {
      mockReadStorageItem.mockReturnValue(ok('plain-model-id'));
      const result = readStoredModelSelection();
      expect(result).toEqual({ id: 'plain-model-id', label: null });
    });

    it('handles empty string stored value', () => {
      mockReadStorageItem.mockReturnValue(ok(''));
      const result = readStoredModelSelection();
      // Implementation: if (!parsed.ok) return raw.length > 0 ? ... : null
      // Empty string -> raw.length === 0 -> null
      expect(result).toBeNull();
    });

    it('handles object with null label', () => {
      mockReadStorageItem.mockReturnValue(ok(JSON.stringify({ id: 'model-1', label: null })));
      const result = readStoredModelSelection();
      expect(result).toEqual({ id: 'model-1', label: null });
    });
  });

  describe('persistModelSelection', () => {
    it('stores selection as JSON', () => {
      persistModelSelection({ id: 'gpt-4', label: 'GPT-4' });
      expect(mockWriteStorageItem).toHaveBeenCalledWith(
        MODEL_SELECTION_STORAGE_KEY,
        JSON.stringify({ id: 'gpt-4', label: 'GPT-4' })
      );
    });

    it('removes selection when null', () => {
      persistModelSelection(null);
      expect(mockRemoveStorageItem).toHaveBeenCalledWith(MODEL_SELECTION_STORAGE_KEY);
    });

    it('stores selection with null label', () => {
      persistModelSelection({ id: 'model-1', label: null });
      expect(mockWriteStorageItem).toHaveBeenCalledWith(
        MODEL_SELECTION_STORAGE_KEY,
        JSON.stringify({ id: 'model-1', label: null })
      );
    });
  });

  describe('deriveSelectionFromOptions', () => {
    const options = [
      { id: 'gpt-4', label: 'GPT-4', badge: 'default', description: '' },
      { id: 'claude-3', label: 'Claude 3', badge: 'default', description: '' },
      { id: 'gemini-2', label: 'Gemini 2', badge: 'default', description: '' },
    ];

    it('returns stored selection when options empty', () => {
      const stored = { id: 'some-id', label: 'Some Model' };
      const result = deriveSelectionFromOptions([], stored, null);
      expect(result).toEqual(stored);
    });

    it('matches stored selection to available options', () => {
      const stored = { id: 'gpt-4', label: 'Old Label' };
      const result = deriveSelectionFromOptions(options, stored, null);
      expect(result).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    });

    it('falls back to default model when stored not found', () => {
      const stored = { id: 'missing-model', label: 'Missing' };
      const result = deriveSelectionFromOptions(options, stored, 'claude-3');
      expect(result).toEqual({ id: 'claude-3', label: 'Claude 3' });
    });

    it('falls back to first option when stored and default not found', () => {
      const stored = { id: 'missing-model', label: 'Missing' };
      const result = deriveSelectionFromOptions(options, stored, 'also-missing');
      expect(result).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    });

    it('uses first option when no stored selection', () => {
      const result = deriveSelectionFromOptions(options, null, null);
      expect(result).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    });

    it('handles null defaultModelId', () => {
      const result = deriveSelectionFromOptions(options, null, null);
      expect(result).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    });
  });

  describe('formatUsageMultiple', () => {
    it('returns null for undefined', () => {
      expect(formatUsageMultiple(undefined)).toBeNull();
    });

    it('returns null for zero', () => {
      expect(formatUsageMultiple(0)).toBeNull();
    });

    it('returns null for negative', () => {
      expect(formatUsageMultiple(-1)).toBeNull();
    });

    it('returns null for NaN', () => {
      expect(formatUsageMultiple(NaN)).toBeNull();
    });

    it('returns null for Infinity', () => {
      expect(formatUsageMultiple(Infinity)).toBeNull();
    });

    it('formats integer values', () => {
      expect(formatUsageMultiple(2)).toBe('2X');
      expect(formatUsageMultiple(10)).toBe('10X');
    });

    it('formats decimal values with 2 decimal places', () => {
      expect(formatUsageMultiple(1.5)).toBe('1.5X');
      expect(formatUsageMultiple(2.25)).toBe('2.25X');
    });

    it('trims trailing zeroes', () => {
      expect(formatUsageMultiple(2.1)).toBe('2.1X');
    });
  });
});
