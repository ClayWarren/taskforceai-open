'use client';

import { useEffect, useRef, useState } from 'react';
import type { OrchestrationConfig } from '@taskforceai/persistence/preferences/orchestration-storage';

export interface UsePersistedOrchestrationConfigParams {
  currentConfig: OrchestrationConfig;
  loadStoredConfig: () => OrchestrationConfig | null | Promise<OrchestrationConfig | null>;
  persistConfig: (config: OrchestrationConfig) => void | Promise<void>;
  applyStoredConfig: (config: OrchestrationConfig) => void;
  onLoadError?: (error: unknown) => void;
}

export function usePersistedOrchestrationConfig({
  currentConfig,
  loadStoredConfig,
  persistConfig,
  applyStoredConfig,
  onLoadError,
}: UsePersistedOrchestrationConfigParams) {
  const [isHydrated, setIsHydrated] = useState(false);
  const didHydrateRef = useRef(false);

  const loadStoredConfigRef = useRef(loadStoredConfig);
  const persistConfigRef = useRef(persistConfig);
  const applyStoredConfigRef = useRef(applyStoredConfig);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    loadStoredConfigRef.current = loadStoredConfig;
    persistConfigRef.current = persistConfig;
    applyStoredConfigRef.current = applyStoredConfig;
    onLoadErrorRef.current = onLoadError;
  }, [applyStoredConfig, loadStoredConfig, onLoadError, persistConfig]);

  useEffect(() => {
    if (didHydrateRef.current) {
      return;
    }
    didHydrateRef.current = true;
    let isCancelled = false;

    void Promise.resolve()
      .then(() => loadStoredConfigRef.current())
      .then((config) => {
        if (!isCancelled && config) {
          applyStoredConfigRef.current(config);
        }
      })
      .catch((error) => {
        onLoadErrorRef.current?.(error);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsHydrated(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    void persistConfigRef.current(currentConfig);
  }, [currentConfig, isHydrated]);

  return { isHydrated };
}
