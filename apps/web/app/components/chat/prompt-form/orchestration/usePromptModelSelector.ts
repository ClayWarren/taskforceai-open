import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { useCallback, useEffect, useMemo } from 'react';
import { canUseModelForPlan, filterPromptSelectableModelOptions } from '@taskforceai/client-core';
import { useHydratedAsyncModelSelector } from '@taskforceai/react-core';

import { logger } from '../../../../lib/logger';
import { loadModelOptions } from '../../../../lib/models/model-selector';
import {
  persistModelSelection,
  readStoredModelSelection,
} from '../../../../lib/prompt/model-selection';

interface UsePromptModelSelectorOptions {
  initialModelSelector?: ModelSelectorResponse | null;
  userPlan?: string | null;
}

export function usePromptModelSelector({
  initialModelSelector = null,
  userPlan,
}: UsePromptModelSelectorOptions) {
  const loadModelSelectorData = useCallback(async () => {
    const response = await loadModelOptions();
    if (!response.ok) {
      throw response.error;
    }
    return response.value;
  }, []);
  const logLoadError = useCallback(
    (error: unknown) => logger.error('Model selector fetch failed', { error }),
    []
  );
  const logHydrationError = useCallback(
    (error: unknown) => logger.error('Failed to hydrate model selection', { error }),
    []
  );

  const selector = useHydratedAsyncModelSelector({
    initialData: initialModelSelector,
    enabled: true,
    loadData: loadModelSelectorData,
    loadStoredSelection: readStoredModelSelection,
    persistSelection: persistModelSelection,
    logLoadError,
    logHydrationError,
  });
  const { effectiveModelId, handleModelSelect, modelOptions } = selector;

  const filteredModelOptions = useMemo(
    () => filterPromptSelectableModelOptions(modelOptions),
    [modelOptions]
  );

  useEffect(() => {
    const selected = modelOptions.find((option) => option.id === effectiveModelId);
    if (!selected || canUseModelForPlan(userPlan, selected.usageMultiple)) return;

    const fallback = filteredModelOptions.find((option) =>
      canUseModelForPlan(userPlan, option.usageMultiple)
    );
    if (fallback) handleModelSelect(fallback.id);
  }, [effectiveModelId, filteredModelOptions, handleModelSelect, modelOptions, userPlan]);

  return {
    ...selector,
    filteredModelOptions,
  };
}
