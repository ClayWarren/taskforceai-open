import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import { useCallback, useMemo, useState } from 'react';

interface UseReasoningEffortOptions {
  modelOptions: ModelOptionSummary[];
  selectedModelId: string | null;
}

export function useReasoningEffort({ modelOptions, selectedModelId }: UseReasoningEffortOptions) {
  const [effortByModel, setEffortByModel] = useState<Record<string, string>>({});

  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === selectedModelId) ?? null,
    [modelOptions, selectedModelId]
  );
  const levels = useMemo(() => selectedModel?.reasoningEffortLevels ?? [], [selectedModel]);
  const configuredDefault = selectedModel?.defaultReasoningEffort;
  const defaultEffort: string | null =
    typeof configuredDefault === 'string' && levels.includes(configuredDefault)
      ? configuredDefault
      : (levels[0] ?? null);
  const storedEffort = selectedModelId ? effortByModel[selectedModelId] : undefined;
  const selectedEffort: string | null =
    typeof storedEffort === 'string' && levels.includes(storedEffort)
      ? storedEffort
      : defaultEffort;

  const setSelectedEffort = useCallback(
    (effort: string) => {
      if (!selectedModelId || !levels.includes(effort)) {
        return;
      }
      setEffortByModel((current) => ({
        ...current,
        [selectedModelId]: effort,
      }));
    },
    [levels, selectedModelId]
  );

  return {
    levels,
    selectedEffort,
    setSelectedEffort,
  };
}
