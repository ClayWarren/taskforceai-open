'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type { StoredModelSelection } from '@taskforceai/shared';
import { definedProps } from '@taskforceai/shared/utils/object';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useModelSelector } from './useModelSelector';

type MaybePromise<T> = T | Promise<T>;

export interface UseHydratedModelSelectorParams {
  data: ModelSelectorResponse | null | undefined;
  loadStoredSelection: () => MaybePromise<StoredModelSelection | null>;
  persistSelection: (selection: StoredModelSelection | null) => Promise<void> | void;
  loading?: boolean;
  closeMenuWhen?: boolean;
  fallbackLabel?: string;
  logHydrationError?: (error: unknown) => void;
}

export function useHydratedModelSelector({
  data,
  loadStoredSelection,
  persistSelection,
  loading = false,
  closeMenuWhen = false,
  fallbackLabel = 'Model',
  logHydrationError,
}: UseHydratedModelSelectorParams) {
  const [storedSelection, setStoredSelection] = useState<StoredModelSelection | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const didHydrateRef = useRef(false);

  useEffect(() => {
    if (didHydrateRef.current) {
      return;
    }
    didHydrateRef.current = true;

    void Promise.resolve()
      .then(() => loadStoredSelection())
      .then((selection) => {
        setStoredSelection(selection);
      })
      .catch((error) => {
        logHydrationError?.(error);
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, [loadStoredSelection, logHydrationError]);

  const selector = useModelSelector({
    data,
    storedSelection,
    onPersist: async (next) => {
      setStoredSelection(next);
      await persistSelection(next);
    },
    loading: loading || !isHydrated,
  });

  useEffect(() => {
    if (!selector.modelSelectorEnabled || selector.modelSelectorLoading || closeMenuWhen) {
      setIsModelMenuOpen(false);
    }
  }, [closeMenuWhen, selector.modelSelectorEnabled, selector.modelSelectorLoading]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (modelId === selector.selectedModelId) {
        setIsModelMenuOpen(false);
        return;
      }
      selector.handleModelSelect(modelId);
      setIsModelMenuOpen(false);
    },
    [selector]
  );

  return {
    ...selector,
    currentModelLabel: selector.selectedModelLabel ?? fallbackLabel,
    effectiveModelId: selector.selectedModelId,
    isHydrated,
    isModelMenuOpen,
    setIsModelMenuOpen,
    handleModelSelect,
    shouldRenderModelSelector: selector.modelSelectorLoading || selector.modelSelectorEnabled,
  };
}

export interface UseHydratedAsyncModelSelectorParams {
  initialData?: ModelSelectorResponse | null;
  enabled?: boolean;
  loadData: () => Promise<ModelSelectorResponse | null>;
  loadStoredSelection: () => MaybePromise<StoredModelSelection | null>;
  persistSelection: (selection: StoredModelSelection | null) => Promise<void> | void;
  closeMenuWhen?: boolean;
  fallbackLabel?: string;
  logHydrationError?: (error: unknown) => void;
  logLoadError?: (error: unknown) => void;
}

export function useHydratedAsyncModelSelector({
  initialData = null,
  enabled = true,
  loadData,
  loadStoredSelection,
  persistSelection,
  closeMenuWhen = false,
  fallbackLabel = 'Model',
  logHydrationError,
  logLoadError,
}: UseHydratedAsyncModelSelectorParams) {
  const [data, setData] = useState<ModelSelectorResponse | null>(enabled ? initialData : null);
  const [isLoadingData, setIsLoadingData] = useState(enabled && !initialData);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setIsLoadingData(false);
      return undefined;
    }

    if (initialData) {
      setData(initialData);
      setIsLoadingData(false);
      return undefined;
    }

    let isCancelled = false;
    setIsLoadingData(true);

    void loadData()
      .then((nextData) => {
        if (!isCancelled) {
          setData(nextData);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          logLoadError?.(error);
          setData(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingData(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled, initialData, loadData, logLoadError]);

  return useHydratedModelSelector({
    data,
    loadStoredSelection,
    persistSelection,
    loading: isLoadingData,
    closeMenuWhen,
    fallbackLabel,
    ...definedProps({ logHydrationError }),
  });
}
