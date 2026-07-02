import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

import { useModelSelector } from './useModelSelector';

const initialData: ModelSelectorResponse = {
  enabled: true,
  defaultModelId: 'model-1',
  options: [
    { id: 'model-1', label: 'Model 1', badge: 'default' },
    { id: 'model-2', label: 'Model 2', badge: 'default' },
  ],
};

describe('useModelSelector', () => {
  it('falls back to a valid option when a manual selection becomes unavailable', async () => {
    const onPersist = vi.fn();

    const { result, rerender } = renderHook(
      (props: { data: ModelSelectorResponse }) =>
        useModelSelector({
          data: props.data,
          storedSelection: null,
          onPersist,
        }),
      { initialProps: { data: initialData } }
    );

    act(() => {
      result.current.handleModelSelect('model-2');
    });
    expect(result.current.selectedModelId).toBe('model-2');

    rerender({
      data: {
        ...initialData,
        options: [{ id: 'model-1', label: 'Model 1', badge: 'default' }],
      },
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe('model-1');
      expect(result.current.selectedModelLabel).toBe('Model 1');
    });
  });

  it('clears the selected model when no valid options remain', async () => {
    const onPersist = vi.fn();

    const { result, rerender } = renderHook(
      (props: { data: ModelSelectorResponse }) =>
        useModelSelector({
          data: props.data,
          storedSelection: null,
          onPersist,
        }),
      { initialProps: { data: initialData } }
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe('model-1');
    });

    rerender({
      data: {
        enabled: false,
        defaultModelId: 'model-1',
        options: [{ id: 'model-1', label: 'Model 1', badge: 'default' }],
      },
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBeNull();
      expect(result.current.selectedModelLabel).toBeNull();
    });

    rerender({
      data: {
        enabled: true,
        defaultModelId: 'model-1',
        options: [],
      },
    });

    expect(result.current.selectedModelId).toBeNull();
    expect(result.current.selectedModelLabel).toBeNull();
  });
});
