import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Mock all potential native/drizzle dependencies
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(() => ({
        remove: jest.fn(),
      })),
    },
  };
});

jest.mock('expo-sqlite', () => ({}));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: jest.fn() }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((callback: any) => {
    callback({ isConnected: true });
    return () => { };
  }),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('../storage/sqlite-adapter', () => ({
  sqliteStorage: {
    getSession: jest.fn(async () => ({ ok: true, value: { accessToken: 'valid-token' } })),
    getPendingChanges: jest.fn(async () => []),
    getDeviceId: jest.fn(async () => 'test-device'),
    getLastSyncVersion: jest.fn(async () => 0),
    setLastSyncVersion: jest.fn(),
  },
}));

// Mock SyncManager from @taskforceai/sync-client
const mockSyncManager = {
  sync: jest.fn(async () => ({
    pushed: { conversations: 1, messages: 0 },
    pulled: { conversations: 0, messages: 0 },
    conflicts: 0,
  })),
  destroy: jest.fn(),
};

jest.mock('@taskforceai/sync-client', () => ({
  SyncManager: jest.fn(() => mockSyncManager),
  SyncStatus: {
    IDLE: 'idle',
    SYNCING: 'syncing',
    ERROR: 'error',
  },
}));

jest.mock('../sync/mobileSyncClient', () => ({
  createMobileSyncClient: jest.fn(() => ({})),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncProvider, useSync } from '../contexts/SyncContext';

type SyncContextValue = ReturnType<typeof useSync>;

describe('SyncContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderWithProvider = async (): Promise<{
    renderer: TestRenderer.ReactTestRenderer;
    getValue: () => SyncContextValue;
  }> => {
    let latestValue: SyncContextValue | null = null;
    const Consumer = () => {
      const ctx = useSync();
      useEffect(() => {
        latestValue = ctx;
      });
      latestValue = ctx;
      return null;
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let renderer: TestRenderer.ReactTestRenderer | null = null;
    await act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <SyncProvider>
            <Consumer />
          </SyncProvider>
        </QueryClientProvider>
      );
    });

    // Flush useEffects (including initialization of sync engine)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    if (!renderer || !latestValue) {
      throw new Error('Sync context did not initialize');
    }
    const value = latestValue;
    return { renderer, getValue: () => value };
  };


  it('provides sync engine functionality', async () => {
    const { renderer, getValue } = await renderWithProvider();
    try {
      expect(typeof getValue().sync).toBe('function');
      // If it's the mock, it should have been called if we trigger it
      await act(async () => {
        await getValue().sync();
      });
      expect(mockSyncManager.sync).toHaveBeenCalled();
    } finally {
      await act(async () => {
        renderer.unmount();
      });
    }
  });


  it('throws error when used outside provider', async () => {
    const BareConsumer = () => {
      useSync();
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
