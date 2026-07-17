import {
  persistStoredOrchestrationConfigValue,
  readStoredOrchestrationConfigValue,
  type OrchestrationConfig,
} from '@taskforceai/persistence/preferences/orchestration-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createModuleLogger } from '../logger';

const ORCHESTRATION_STORAGE_KEY = '@taskforceai:orchestration-config';

const logger = createModuleLogger('OrchestrationPreference');

export const readStoredOrchestrationConfig = async (): Promise<OrchestrationConfig | null> => {
  return readStoredOrchestrationConfigValue(
    {
      read: () => AsyncStorage.getItem(ORCHESTRATION_STORAGE_KEY),
    },
    {
      onReadError: (error) => logger.error('Failed to load orchestration config', { error }),
    }
  );
};

export const persistOrchestrationConfig = async (config: OrchestrationConfig) => {
  await persistStoredOrchestrationConfigValue(
    {
      write: (value) => AsyncStorage.setItem(ORCHESTRATION_STORAGE_KEY, value),
    },
    config,
    {
      onWriteError: (error, value) =>
        logger.error('Failed to persist orchestration config', { error, config: value }),
    }
  );
};
