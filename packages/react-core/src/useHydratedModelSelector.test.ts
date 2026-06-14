import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import {
  useHydratedAsyncModelSelector,
  useHydratedModelSelector,
} from './useHydratedModelSelector';

const data: ModelSelectorResponse = {
  enabled: true,
  defaultModelId: 'model-1',
  options: [
    { id: 'model-1', label: 'Model 1', badge: 'default' },
    { id: 'model-2', label: 'Model 2', badge: 'default' },
  ],
};

describe('useHydratedModelSelector', () => {
  it('hydrates stored selection and persists model changes', async () => {
    const loadStoredSelection = vi.fn(async () => ({ id: 'model-2', label: 'Stored Model 2' }));
    const persistSelection = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useHydratedModelSelector({
        data,
        loadStoredSelection,
        persistSelection,
      })
    );

    expect(result.current.modelSelectorLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.effectiveModelId).toBe('model-2');
      expect(result.current.currentModelLabel).toBe('Model 2');
      expect(result.current.modelSelectorLoading).toBe(false);
    });

    act(() => {
      result.current.handleModelSelect('model-1');
    });

    expect(result.current.effectiveModelId).toBe('model-1');
    expect(persistSelection).toHaveBeenCalledWith({ id: 'model-1', label: 'Model 1' });
  });

  it('falls back after hydration failure and closes menu when disabled', async () => {
    const error = new Error('storage failed');
    const logHydrationError = vi.fn();
    const { result, rerender } = renderHook(
      ({ closeMenuWhen }: { closeMenuWhen: boolean }) =>
        useHydratedModelSelector({
          data,
          loadStoredSelection: async () => {
            throw error;
          },
          persistSelection: vi.fn(),
          closeMenuWhen,
          logHydrationError,
        }),
      { initialProps: { closeMenuWhen: false } }
    );

    await waitFor(() => {
      expect(result.current.effectiveModelId).toBe('model-1');
      expect(result.current.isHydrated).toBe(true);
    });
    expect(logHydrationError).toHaveBeenCalledWith(error);

    act(() => {
      result.current.setIsModelMenuOpen(true);
    });
    expect(result.current.isModelMenuOpen).toBe(true);

    rerender({ closeMenuWhen: true });
    expect(result.current.isModelMenuOpen).toBe(false);
  });

  it('loads selector data when no initial data is provided', async () => {
    const loadData = vi.fn(async () => ({
      enabled: true,
      defaultModelId: 'model-2',
      options: data.options,
    }));
    const persistSelection = vi.fn();

    const { result } = renderHook(() =>
      useHydratedAsyncModelSelector({
        loadData,
        loadStoredSelection: () => null,
        persistSelection,
      })
    );

    expect(result.current.modelSelectorLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.modelSelectorLoading).toBe(false);
      expect(result.current.effectiveModelId).toBe('model-2');
    });

    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('stays disabled and does not load data when disabled', async () => {
    const loadData = vi.fn(async () => data);

    const { result } = renderHook(() =>
      useHydratedAsyncModelSelector({
        enabled: false,
        loadData,
        loadStoredSelection: () => null,
        persistSelection: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(result.current.modelSelectorLoading).toBe(false);
    });

    expect(result.current.modelSelectorEnabled).toBe(false);
    expect(result.current.modelOptions).toEqual([]);
    expect(loadData).not.toHaveBeenCalled();
  });

  it('logs load failures and falls back to no options', async () => {
    const error = new Error('load failed');
    const logLoadError = vi.fn();

    const { result } = renderHook(() =>
      useHydratedAsyncModelSelector({
        loadData: async () => {
          throw error;
        },
        loadStoredSelection: () => null,
        persistSelection: vi.fn(),
        logLoadError,
      })
    );

    await waitFor(() => {
      expect(result.current.modelSelectorLoading).toBe(false);
    });

    expect(result.current.modelSelectorEnabled).toBe(false);
    expect(result.current.modelOptions).toEqual([]);
    expect(logLoadError).toHaveBeenCalledWith(error);
  });
});
