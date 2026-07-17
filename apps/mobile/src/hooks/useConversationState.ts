import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConversationState as useSharedConversationState } from '@taskforceai/react-core';
import type { KeyValueStorage } from '@taskforceai/react-core';

import { mobileConversationStore } from '../storage/chat-local-mobile';
import { GUEST_CONVERSATION_ID_PREFIX } from '../storage/conversations/ownership';

export const ACTIVE_CONVERSATION_KEY = '@taskforceai:activeConversationId';
export const GUEST_ACTIVE_CONVERSATION_KEY = `${ACTIVE_CONVERSATION_KEY}:guest`;

const mobileStorage: KeyValueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

type MobileConversationAuthState = {
  isAuthenticated?: boolean;
  sessionStatus?: 'loading' | 'authenticated' | 'unauthenticated';
  user?: unknown;
  isPrivateMode?: boolean;
};

export function useConversationState(authState: MobileConversationAuthState = {}) {
  const isGuest = authState.isAuthenticated === false;
  return useSharedConversationState({
    conversationStore: mobileConversationStore,
    storage: mobileStorage,
    activeConversationKey: isGuest ? GUEST_ACTIVE_CONVERSATION_KEY : ACTIVE_CONVERSATION_KEY,
    conversationIdPrefix: isGuest ? GUEST_CONVERSATION_ID_PREFIX : 'local',
    ...authState,
  });
}
