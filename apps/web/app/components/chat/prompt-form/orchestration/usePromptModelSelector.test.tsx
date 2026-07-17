import '../../../../../../../tests/setup/dom';

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

const filterPromptSelectableModelOptionsMock = vi.fn();
const useHydratedAsyncModelSelectorMock = vi.fn();
const loggerErrorMock = vi.fn();
const loadModelOptionsMock = vi.fn();
const persistModelSelectionMock = vi.fn();
const readStoredModelSelectionMock = vi.fn();

vi.mock('@taskforceai/client-core', () => ({
  canUseModelForPlan: (plan: string | null | undefined, usageMultiple?: number) =>
    plan === 'pro' || plan === 'super' || (usageMultiple ?? 0) <= 1.5,
  filterPromptSelectableModelOptions: filterPromptSelectableModelOptionsMock,
}));

vi.mock('@taskforceai/react-core', () => ({
  useHydratedAsyncModelSelector: useHydratedAsyncModelSelectorMock,
}));

vi.mock('../../../../lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('../../../../lib/models/model-selector', () => ({
  loadModelOptions: loadModelOptionsMock,
}));

vi.mock('../../../../lib/prompt/model-selection', () => ({
  persistModelSelection: persistModelSelectionMock,
  readStoredModelSelection: readStoredModelSelectionMock,
}));

import { usePromptModelSelector } from './usePromptModelSelector';

describe('usePromptModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filterPromptSelectableModelOptionsMock.mockReturnValue([
      { id: 'filtered-model', label: 'Filtered model', badge: 'Pro' },
    ]);
    useHydratedAsyncModelSelectorMock.mockImplementation(() => ({
      modelOptions: [
        { id: 'raw-model', label: 'Raw model', supports_prompt_form: true },
        { id: 'internal-model', label: 'Internal model', supports_prompt_form: false },
      ],
      selectedModel: 'raw-model',
    }));
  });

  it('wires model loading, persistence, and prompt-selectable filtering', async () => {
    const initialModelSelector = {
      default_model: 'raw-model',
      models: [{ id: 'raw-model', label: 'Raw model' }],
    };
    const loadedModelSelector = {
      default_model: 'loaded-model',
      models: [{ id: 'loaded-model', label: 'Loaded model' }],
    };
    loadModelOptionsMock.mockResolvedValue({ ok: true, value: loadedModelSelector });

    const { result } = renderHook(() =>
      usePromptModelSelector({ initialModelSelector: initialModelSelector as never })
    );
    const config = useHydratedAsyncModelSelectorMock.mock.calls[0]?.[0];

    expect(config.initialData).toBe(initialModelSelector);
    expect(config.enabled).toBe(true);
    expect(config.loadStoredSelection).toBe(readStoredModelSelectionMock);
    expect(config.persistSelection).toBe(persistModelSelectionMock);
    await expect(config.loadData()).resolves.toBe(loadedModelSelector);
    expect(filterPromptSelectableModelOptionsMock).toHaveBeenCalledWith([
      { id: 'raw-model', label: 'Raw model', supports_prompt_form: true },
      { id: 'internal-model', label: 'Internal model', supports_prompt_form: false },
    ]);
    expect(result.current.filteredModelOptions).toEqual([
      { id: 'filtered-model', label: 'Filtered model', badge: 'Pro' },
    ]);
  });

  it('surfaces model load failures and logs hydration failures', async () => {
    const loadError = new Error('model catalog unavailable');
    const hydrationError = new Error('stored model invalid');
    loadModelOptionsMock.mockResolvedValue({ ok: false, error: loadError });

    renderHook(() => usePromptModelSelector({}));
    const config = useHydratedAsyncModelSelectorMock.mock.calls[0]?.[0];

    await expect(config.loadData()).rejects.toBe(loadError);
    config.logLoadError(loadError);
    config.logHydrationError(hydrationError);

    expect(loggerErrorMock).toHaveBeenCalledWith('Model selector fetch failed', {
      error: loadError,
    });
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to hydrate model selection', {
      error: hydrationError,
    });
  });

  it('moves free users off a previously selected paid model', () => {
    const handleModelSelect = vi.fn();
    const options = [
      { id: 'paid-model', label: 'Paid', usageMultiple: 2 },
      { id: 'free-model', label: 'Free', usageMultiple: 1 },
    ];
    filterPromptSelectableModelOptionsMock.mockReturnValue(options);
    useHydratedAsyncModelSelectorMock.mockReturnValue({
      modelOptions: options,
      effectiveModelId: 'paid-model',
      handleModelSelect,
    });

    renderHook(() => usePromptModelSelector({ userPlan: 'free' }));

    expect(handleModelSelect).toHaveBeenCalledWith('free-model');
  });
});
