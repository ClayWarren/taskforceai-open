import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { useCacheMaintenance } from '../hooks/useCacheMaintenance';
import { sqliteStorage } from '../storage/sqlite-adapter';
import type { Message } from '../types';

jest.mock('../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    clearAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn(),
  },
}));

type ConversationOption = {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
};
type CacheHookOptions = {
  conversation: ConversationOption;
  translate: (key: string) => string;
  logout?: () => Promise<void>;
};

const renderUseCacheMaintenance = (
  options: CacheHookOptions
): { hook: ReturnType<typeof useCacheMaintenance>; cleanup: () => void } => {
  let hookValue: ReturnType<typeof useCacheMaintenance> | null = null;
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const Wrapper: React.FC = () => {
    hookValue = useCacheMaintenance(options);
    return null;
  };

  act(() => {
    renderer = TestRenderer.create(<Wrapper />);
  });

  const cleanup = () => {
    act(() => {
      if (renderer) {
        renderer.unmount();
      }
    });
  };

  if (!hookValue || !renderer) {
    throw new Error('Hook did not initialize');
  }

  return { hook: hookValue, cleanup };
};

const dictionary: Record<string, string> = {
  'mobile.settings.cacheClearedTitle': 'Cache cleared',
  'mobile.settings.cacheClearedMessage': 'Storage reset successfully',
  'mobile.settings.cacheErrorTitle': 'Cache error',
  'mobile.settings.cacheErrorMessage': 'Unable to clear cache',
};

const t = (key: string) => dictionary[key] ?? key;

describe('useCacheMaintenance', () => {
  const clearAllMock = jest.mocked(sqliteStorage.clearAll);
  const alertMock = jest.mocked(Alert.alert);
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('clears cache and notifies user on success', async () => {
    const conversation: ConversationOption = {
      setMessages: jest.fn(),
    };

    const { hook, cleanup } = renderUseCacheMaintenance({
      conversation,
      translate: t,
    });

    await hook.handleClearCache();

    expect(clearAllMock).toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@taskforceai:activeConversationId');
    expect(conversation.setMessages).toHaveBeenCalledWith([]);
    expect(alertMock).toHaveBeenCalledWith('Cache cleared', 'Storage reset successfully');
    cleanup();
  });

  it('logs out instead of clearing storage directly when authenticated', async () => {
    const logout = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const conversation: ConversationOption = {
      setMessages: jest.fn(),
    };

    const { hook, cleanup } = renderUseCacheMaintenance({
      conversation,
      logout,
      translate: t,
    });

    await hook.handleClearCache();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(clearAllMock).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@taskforceai:activeConversationId');
    expect(conversation.setMessages).toHaveBeenCalledWith([]);
    expect(alertMock).toHaveBeenCalledWith('Cache cleared', 'Storage reset successfully');
    cleanup();
  });

  it('surfaces error when cache clearing fails', async () => {
    clearAllMock.mockRejectedValueOnce(new Error('disk error'));
    const conversation: ConversationOption = {
      setMessages: jest.fn(),
    };

    const { hook, cleanup } = renderUseCacheMaintenance({
      conversation,
      translate: t,
    });

    await hook.handleClearCache();

    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(conversation.setMessages).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith('Cache error', 'Unable to clear cache');
    cleanup();
  });
});
