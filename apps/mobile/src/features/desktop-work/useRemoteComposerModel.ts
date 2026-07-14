import React from 'react';

import { useModelSelectorQuery } from '../../hooks/api/modelSelector';

export function useRemoteComposerModel(running = false) {
  const [selectedModelId, setSelectedModelId] = React.useState<string | null>(null);
  const [effortByModel, setEffortByModel] = React.useState<Record<string, string>>({});
  const modelQuery = useModelSelectorQuery();
  const options = modelQuery.data?.options ?? [];
  const effectiveModelId =
    selectedModelId ?? modelQuery.data?.defaultModelId ?? options[0]?.id ?? null;
  const selectedModel = options.find((option) => option.id === effectiveModelId) ?? null;
  const effortLevels = selectedModel?.reasoningEffortLevels ?? [];
  const selectedEffort = effectiveModelId
    ? effortByModel[effectiveModelId] ??
      selectedModel?.defaultReasoningEffort ??
      effortLevels[0] ??
      null
    : null;

  return {
    effectiveModelId,
    modelQuery,
    options,
    selectedEffort,
    selectEffort: (effort: string) => {
      if (!effectiveModelId) return false;
      setEffortByModel((current) => ({ ...current, [effectiveModelId]: effort }));
      return running;
    },
    selectModel: (modelId: string) => {
      setSelectedModelId(modelId);
      return running;
    },
  };
}
