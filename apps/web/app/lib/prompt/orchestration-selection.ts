import {
  parseOrchestrationConfig,
  persistStoredOrchestrationConfigValue,
  type OrchestrationConfig,
} from '@taskforceai/persistence/preferences/orchestration-storage';
import { readStorageItem, writeStorageItem } from '@taskforceai/browser-runtime/browser-storage';

export const ORCHESTRATION_STORAGE_KEY = 'taskforceai:orchestration-config';

export const readStoredOrchestrationConfig = (): OrchestrationConfig | null => {
  const rawResult = readStorageItem(ORCHESTRATION_STORAGE_KEY);
  if (!rawResult.ok) return null;
  return parseOrchestrationConfig(rawResult.value);
};

export const persistOrchestrationConfig = (config: OrchestrationConfig) => {
  void persistStoredOrchestrationConfigValue(
    {
      write: (value) => {
        writeStorageItem(ORCHESTRATION_STORAGE_KEY, value);
      },
    },
    config
  );
};
