import { readStorageItem, writeStorageItem } from '@taskforceai/shared/utils/browser-storage';

export type ComputerUseSessionMode = 'logged_out' | 'logged_in';

export const COMPUTER_USE_SESSION_MODE_STORAGE_KEY = 'taskforceai:computer-use-session-mode';
export const COMPUTER_USE_SESSION_MODE_EVENT = 'taskforceai:computer-use-session-mode';

const DEFAULT_COMPUTER_USE_SESSION_MODE: ComputerUseSessionMode = 'logged_out';

const isComputerUseSessionMode = (value: string): value is ComputerUseSessionMode =>
  value === 'logged_out' || value === 'logged_in';

export const readStoredComputerUseSessionMode = (): ComputerUseSessionMode => {
  const stored = readStorageItem(COMPUTER_USE_SESSION_MODE_STORAGE_KEY);
  if (!stored.ok) {
    return DEFAULT_COMPUTER_USE_SESSION_MODE;
  }

  return isComputerUseSessionMode(stored.value) ? stored.value : DEFAULT_COMPUTER_USE_SESSION_MODE;
};

export const persistComputerUseSessionMode = (mode: ComputerUseSessionMode) => {
  writeStorageItem(COMPUTER_USE_SESSION_MODE_STORAGE_KEY, mode);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(COMPUTER_USE_SESSION_MODE_EVENT, {
        detail: { mode },
      })
    );
  }
};
