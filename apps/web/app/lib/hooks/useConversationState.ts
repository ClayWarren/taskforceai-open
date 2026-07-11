import { useConversationState as useSharedConversationState } from '@taskforceai/react-core';
import type { KeyValueStorage } from '@taskforceai/react-core';
import { useConversationStore } from '../platform/PlatformProvider';
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/browser-runtime/browser-storage';
import { useAuth } from '../providers/AuthProvider';

const ACTIVE_CONVERSATION_KEY = 'activeConversationId';

const browserStorage: KeyValueStorage = {
  getItem: (key) => {
    const result = readStorageItem(key);
    return result.ok ? result.value : null;
  },
  setItem: (key, value) => {
    writeStorageItem(key, value);
  },
  removeItem: (key) => {
    removeStorageItem(key);
  },
};

export function useConversationState(options: { isPrivateMode?: boolean } = {}) {
  const { isAuthenticated, sessionStatus, user } = useAuth();
  const conversationStore = useConversationStore();

  return useSharedConversationState({
    conversationStore,
    storage: browserStorage,
    activeConversationKey: ACTIVE_CONVERSATION_KEY,
    isPrivateMode: options.isPrivateMode ?? false,
    isAuthenticated,
    sessionStatus,
    user,
  });
}
