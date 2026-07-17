'use client';

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import { type StoredModelSelection, deriveSelectionFromOptions } from '@taskforceai/client-core';

export interface UseModelSelectorParams {
  /**
   * Data already fetched from the server.
   */
  data: ModelSelectorResponse | null | undefined;

  /**
   * Current stored selection from local storage.
   */
  storedSelection: StoredModelSelection | null;

  /**
   * Callback to persist the user's selection choice.
   */
  onPersist: (selection: StoredModelSelection | null) => void | Promise<void>;

  /**
   * Initial loading state (if using a separate loading indicator).
   */
  loading?: boolean;
}

/**
 * Headless hook to manage the business logic of AI model selection.
 *
 * It handles calculating the active model based on server-provided defaults,
 * previous user choices, and available options. It ensures the state is
 * kept in sync with the underlying options.
 */
export function useModelSelector({
  data,
  storedSelection,
  onPersist,
  loading = false,
}: UseModelSelectorParams) {
  const hasManuallySelected = useRef(false);

  // Derive the best candidate for initial selection
  const preloadedSelection = useMemo<StoredModelSelection | null>(() => {
    if (!data) return storedSelection;
    if (!data.enabled || (data.options?.length ?? 0) === 0) return null;

    return deriveSelectionFromOptions(data.options ?? [], storedSelection, data.defaultModelId);
  }, [data, storedSelection]);

  const [selectedModelId, setSelectedModelId] = useState<string | null>(
    preloadedSelection?.id ?? null
  );
  const [selectedModelLabel, setSelectedModelLabel] = useState<string | null>(
    preloadedSelection?.label ?? null
  );

  // Sync state if options change or a new "preloaded" candidate is found
  useEffect(() => {
    if (!preloadedSelection) {
      if (data && (selectedModelId !== null || selectedModelLabel !== null)) {
        hasManuallySelected.current = false;
        setSelectedModelId(null);
        setSelectedModelLabel(null);
      }
      return;
    }

    const availableOptionIds = new Set((data?.options ?? []).map((option) => option.id));
    const hasCurrentSelection = selectedModelId !== null && availableOptionIds.has(selectedModelId);

    const shouldResyncToPreloaded = !hasManuallySelected.current || !hasCurrentSelection;

    if (
      shouldResyncToPreloaded &&
      (preloadedSelection.id !== selectedModelId || preloadedSelection.label !== selectedModelLabel)
    ) {
      hasManuallySelected.current = false;
      setSelectedModelId(preloadedSelection.id);
      setSelectedModelLabel(preloadedSelection.label);
    }
  }, [data, preloadedSelection, selectedModelId, selectedModelLabel]);

  // Stabilize onPersist via ref
  const onPersistRef = useRef(onPersist);
  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);

  // Seed default persistence only after any external storage hydration has completed.
  useEffect(() => {
    if (!loading && !storedSelection && preloadedSelection) {
      void onPersistRef.current(preloadedSelection);
    }
  }, [loading, preloadedSelection, storedSelection]);

  const handleModelSelect = useCallback(
    (nextModelId: string) => {
      const options = data?.options ?? [];
      const matchingOption = options.find((option) => option.id === nextModelId);
      const label = matchingOption?.label ?? null;

      hasManuallySelected.current = true;
      setSelectedModelId(nextModelId);
      setSelectedModelLabel(label);
      void onPersist({ id: nextModelId, label });
    },
    [data?.options, onPersist]
  );

  return {
    modelOptions: data?.options ?? [],
    modelSelectorEnabled: (data?.enabled ?? false) && (data?.options?.length ?? 0) > 0,
    selectedModelId,
    selectedModelLabel,
    modelSelectorLoading: loading,
    handleModelSelect,
    preloadedSelection,
  };
}
