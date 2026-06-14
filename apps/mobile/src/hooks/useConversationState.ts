import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConversationState as useSharedConversationState } from '@taskforceai/react-core';
import type { KeyValueStorage } from '@taskforceai/react-core';

import { mobileConversationStore } from '../storage/chat-local-mobile';

export const ACTIVE_CONVERSATION_KEY = '@taskforceai:activeConversationId';

const mobileStorage: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

type MobileConversationAuthState = {
  isAuthenticated?: boolean;
  sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  user?: unknown;
};

export function useConversationState(authState: MobileConversationAuthState = {}) {
  return useSharedConversationState({
    conversationStore: mobileConversationStore,
    storage: mobileStorage,
    activeConversationKey: ACTIVE_CONVERSATION_KEY,
    ...authState,
  });
}
