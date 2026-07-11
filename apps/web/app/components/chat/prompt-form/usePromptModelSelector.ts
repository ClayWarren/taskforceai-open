import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { useCallback, useMemo } from 'react';
import { filterPromptSelectableModelOptions } from '@taskforceai/client-core';
import { useHydratedAsyncModelSelector } from '@taskforceai/react-core';

import { logger } from '../../../lib/logger';
import { loadModelOptions } from '../../../lib/models/model-selector';
import {
  persistModelSelection,
  readStoredModelSelection,
} from '../../../lib/prompt/model-selection';

interface UsePromptModelSelectorOptions {
  initialModelSelector?: ModelSelectorResponse | null;
}

export function usePromptModelSelector({
  initialModelSelector = null,
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

  const filteredModelOptions = useMemo(
    () => filterPromptSelectableModelOptions(selector.modelOptions),
    [selector.modelOptions]
  );

  return {
    ...selector,
    filteredModelOptions,
  };
}
