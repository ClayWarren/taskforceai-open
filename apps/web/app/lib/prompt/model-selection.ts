import { type StoredModelSelection } from '@taskforceai/client-core';
import {
  parseStoredModelSelection,
  persistStoredModelSelectionValue,
} from '@taskforceai/persistence/preferences/model-selection-storage';
export type { StoredModelSelection };

import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/browser-runtime/browser-storage';

export const MODEL_SELECTION_STORAGE_KEY = 'taskforceai:model-selection';

export const readStoredModelSelection = (): StoredModelSelection | null => {
  const rawResult = readStorageItem(MODEL_SELECTION_STORAGE_KEY);
  if (!rawResult.ok) {
    return null;
  }
  const raw = rawResult.value;
  return parseStoredModelSelection(raw);
};

export const persistModelSelection = (selection: StoredModelSelection | null) => {
  void persistStoredModelSelectionValue(
    {
      write: (value) => {
        writeStorageItem(MODEL_SELECTION_STORAGE_KEY, value);
      },
      remove: () => {
        removeStorageItem(MODEL_SELECTION_STORAGE_KEY);
      },
    },
    selection
  );
};
