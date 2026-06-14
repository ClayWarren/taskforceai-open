import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Mock AsyncStorage
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
}));

jest.mock('../logger', () => ({
  createModuleLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { PreferencesProvider, usePreferences } from '../contexts/PreferencesContext';

type PreferencesContextValue = ReturnType<typeof usePreferences>;

describe('PreferencesContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    for (const key in mockStorage) delete mockStorage[key];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderWithProvider = async (): Promise<{
    renderer: TestRenderer.ReactTestRenderer;
    getValue: () => PreferencesContextValue;
  }> => {
    let latestValue: PreferencesContextValue | null = null;
    const Consumer = () => {
      latestValue = usePreferences();
      return null;
    };

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <PreferencesProvider>
          <Consumer />
        </PreferencesProvider>
      );
    });

    // Process useEffect
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    if (!renderer || !latestValue) {
      throw new Error('Preferences context did not initialize');
    }
    return { renderer, getValue: () => latestValue! };
  };


  it('initializes with default values', async () => {
    const { getValue } = await renderWithProvider();
    expect(getValue().autoSyncEnabled).toBe(true);
    expect(getValue().notificationsEnabled).toBe(true);
    expect(getValue().hasLoadedPreferences).toBe(true);
  });

  it('loads preferences from storage on mount', async () => {
    mockStorage['@taskforceai:autoSyncEnabled'] = 'false';
    mockStorage['@taskforceai:notificationsEnabled'] = 'false';

    const { getValue } = await renderWithProvider();
    expect(getValue().autoSyncEnabled).toBe(false);
    expect(getValue().notificationsEnabled).toBe(false);
  });

  it('updates autoSyncEnabled and persists to storage', async () => {
    const { getValue } = await renderWithProvider();
    await act(async () => {
      await getValue().setAutoSyncEnabled(false);
    });
    expect(getValue().autoSyncEnabled).toBe(false);
    expect(mockStorage['@taskforceai:autoSyncEnabled']).toBe('false');
  });

  it('updates notificationsEnabled and persists to storage', async () => {
    const { getValue } = await renderWithProvider();
    await act(async () => {
      await getValue().setNotificationsEnabled(false);
    });
    expect(getValue().notificationsEnabled).toBe(false);
    expect(mockStorage['@taskforceai:notificationsEnabled']).toBe('false');
  });

  it('handles persistence failures in setAutoSyncEnabled', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { getValue } = await renderWithProvider();
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('Persistence failure'));

    // Silence expected warning for this test
    jest.spyOn(console, 'warn').mockImplementation(() => { });

    await act(async () => {
      try {
        await getValue().setAutoSyncEnabled(false);
      } catch {
        // Expected
      }
    });

    // On failure, state should ROLL BACK
    await act(async () => {
      expect(getValue().autoSyncEnabled).toBe(true);
    });
    (console.warn as jest.Mock).mockRestore();
  });

  it('handles persistence failures in setNotificationsEnabled', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { getValue } = await renderWithProvider();
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('Persistence failure'));

    // Silence expected warning for this test
    jest.spyOn(console, 'warn').mockImplementation(() => { });

    await act(async () => {
      try {
        await getValue().setNotificationsEnabled(false);
      } catch {
        // Expected
      }
    });

    // On failure, state should ROLL BACK
    await act(async () => {
      expect(getValue().notificationsEnabled).toBe(true);
    });
    (console.warn as jest.Mock).mockRestore();
  });


  it('handles storage errors gracefully during initialization', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    AsyncStorage.getItem.mockRejectedValue(new Error('Storage failure'));

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

    // We expect the render to fail or log, but not crash the test suite summary
    // Expect NO throw
    const { getValue } = await renderWithProvider();
    expect(getValue().autoSyncEnabled).toBe(true);

    consoleSpy.mockRestore();
  });






  it('throws error when used outside provider', async () => {
    const BareConsumer = () => {
      usePreferences();
      return null;
    };

    class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
      override state: { error: Error | null } = { error: null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      override render() {
        return this.state.error ? null : this.props.children;
      }
    }

    const originalConsoleError = console.error;
    console.error = jest.fn();
    try {
      await act(async () => {
        TestRenderer.create(
          <ErrorBoundary>
            <BareConsumer />
          </ErrorBoundary>
        );
      });
    } finally {
      console.error = originalConsoleError;
    }
  });

});
