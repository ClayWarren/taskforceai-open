import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { createModuleLogger } from '../logger';
import { sqliteStorage } from '../storage/sqlite-adapter';
import type { Message } from '../types';
import { ACTIVE_CONVERSATION_KEY } from './useConversationState';

interface ConversationControls {
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

interface UseCacheMaintenanceOptions {
  conversation: ConversationControls;
  translate: (key: string) => string;
  logout?: () => Promise<void>;
}

const logger = createModuleLogger('useCacheMaintenance');

export function useCacheMaintenance({ conversation, translate, logout }: UseCacheMaintenanceOptions) {
  const handleClearCache = useCallback(async () => {
    try {
      if (logout) {
        await logout();
      } else {
        await sqliteStorage.clearAll();
      }
      await AsyncStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      conversation.setMessages([]);
      Alert.alert(
        translate('mobile.settings.cacheClearedTitle'),
        translate('mobile.settings.cacheClearedMessage')
      );
    } catch (error) {
      logger.error('Failed to clear cache', { error });
      Alert.alert(
        translate('mobile.settings.cacheErrorTitle'),
        translate('mobile.settings.cacheErrorMessage')
      );
    }
  }, [conversation, logout, translate]);

  return { handleClearCache };
}
