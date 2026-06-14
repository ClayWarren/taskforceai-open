import AsyncStorage from '@react-native-async-storage/async-storage';
import { type StoredModelSelection } from '@taskforceai/shared';
import {
  persistStoredModelSelectionValue,
  readStoredModelSelectionValue,
} from '@taskforceai/shared/chat/model-selection-storage';

import { createModuleLogger } from '../logger';

const MODEL_SELECTION_KEY = '@taskforceai:model-selection';
const logger = createModuleLogger('ModelPreference');

export const loadModelPreference = async (): Promise<StoredModelSelection | null> => {
  return readStoredModelSelectionValue({
    read: () => AsyncStorage.getItem(MODEL_SELECTION_KEY),
    onReadError: (error) => logger.error('Failed to load model selection', { error }),
  });
};

export const storeModelPreference = async (selection: StoredModelSelection | null): Promise<void> => {
  await persistStoredModelSelectionValue(
    {
      write: (value) => AsyncStorage.setItem(MODEL_SELECTION_KEY, value),
      remove: () => AsyncStorage.removeItem(MODEL_SELECTION_KEY),
      onWriteError: (error, failedSelection) =>
        logger.error('Failed to persist model selection', { error, selection: failedSelection }),
    },
    selection,
  );
};
