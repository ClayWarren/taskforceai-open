import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

import { usePersistedOrchestrationConfig } from './usePersistedOrchestrationConfig';

describe('usePersistedOrchestrationConfig', () => {
  it('applies stored config before persisting current config', async () => {
    const loadStoredConfig = vi.fn(
      async () =>
        ({
          roleModels: { planner: 'gpt-5' },
          budget: 25,
          agentCount: 6,
        }) as const
    );
    const persistConfig = vi.fn(async () => undefined);
    const applyStoredConfig = vi.fn();

    const { result } = renderHook(() =>
      usePersistedOrchestrationConfig({
        currentConfig: { roleModels: {}, budget: undefined, agentCount: 4 },
        loadStoredConfig,
        persistConfig,
        applyStoredConfig,
      })
    );

    expect(result.current.isHydrated).toBe(false);

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(applyStoredConfig).toHaveBeenCalledWith({
      roleModels: { planner: 'gpt-5' },
      budget: 25,
      agentCount: 6,
    });
    expect(persistConfig).toHaveBeenCalledWith({
      roleModels: {},
      budget: undefined,
      agentCount: 4,
    });
  });

  it('waits for async hydration before persisting and reports load failures', async () => {
    const error = new Error('storage failed');
    const loadStoredConfig = vi.fn(async () => {
      throw error;
    });
    const persistConfig = vi.fn(async () => undefined);
    const onLoadError = vi.fn();

    const { result } = renderHook(() =>
      usePersistedOrchestrationConfig({
        currentConfig: { roleModels: {}, budget: undefined, agentCount: 4 },
        loadStoredConfig,
        persistConfig,
        applyStoredConfig: vi.fn(),
        onLoadError,
      })
    );

    expect(persistConfig).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(onLoadError).toHaveBeenCalledWith(error);
    expect(persistConfig).toHaveBeenCalledTimes(1);
  });

  it('persists when the current config changes after hydration', async () => {
    const persistConfig = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ agentCount }: { agentCount: number }) =>
        usePersistedOrchestrationConfig({
          currentConfig: { roleModels: {}, budget: undefined, agentCount },
          loadStoredConfig: async () => null,
          persistConfig,
          applyStoredConfig: vi.fn(),
        }),
      { initialProps: { agentCount: 4 } }
    );

    await waitFor(() => expect(persistConfig).toHaveBeenCalledTimes(1));

    act(() => {
      rerender({ agentCount: 8 });
    });

    await waitFor(() => {
      expect(persistConfig).toHaveBeenLastCalledWith({
        roleModels: {},
        budget: undefined,
        agentCount: 8,
      });
    });
  });
});
