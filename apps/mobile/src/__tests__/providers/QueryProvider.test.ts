import { afterEach, describe, expect, it, jest } from '@jest/globals';

type QueryProviderHarness = {
  QueryProvider: (props: { children?: unknown }) => unknown;
  React: typeof import('react');
  TestRenderer: typeof import('react-test-renderer');
  addNetInfoEventListener: jest.Mock;
  onlineSetEventListener: jest.Mock;
  focusSetEventListener: jest.Mock;
  appStateAddEventListener: jest.Mock;
  persistProviderSpy: jest.Mock;
  createSqlitePersister: jest.Mock;
  queryClient: { id: string };
  persister: { id: string };
};

const loadQueryProviderHarness = (): QueryProviderHarness => {
  jest.resetModules();
  jest.unmock('react-native');
  jest.unmock('react-native-css');

  let loadedHarness: QueryProviderHarness | null = null;

  jest.isolateModules(() => {
    const React = require('react') as typeof import('react');
    const addNetInfoEventListener = jest.fn();
    const onlineSetEventListener = jest.fn();
    const focusSetEventListener = jest.fn();
    const appStateAddEventListener = jest.fn();
    const persistProviderSpy = jest.fn(
      ({ children }: { children?: React.ReactNode }) =>
        React.createElement('PersistQueryClientProvider', null, children)
    );
    const createSqlitePersister = jest.fn();
    const queryClient = { id: 'query-client' };
    const persister = { id: 'sqlite-persister' };

    createSqlitePersister.mockReturnValue(persister);

    jest.doMock('@react-native-community/netinfo', () => ({
      __esModule: true,
      default: {
        addEventListener: addNetInfoEventListener,
      },
      addEventListener: addNetInfoEventListener,
    }));

    jest.doMock('@tanstack/react-query', () => ({
      onlineManager: {
        setEventListener: onlineSetEventListener,
      },
      focusManager: {
        setEventListener: focusSetEventListener,
      },
    }));

    jest.doMock('@tanstack/react-query-persist-client', () => ({
      PersistQueryClientProvider: (props: { children?: React.ReactNode }) =>
        persistProviderSpy(props),
    }));

    jest.doMock('react-native', () => {
      const appState = {
        addEventListener: appStateAddEventListener,
      };

      return {
        __esModule: true,
        AppState: appState,
        default: {
          AppState: appState,
        },
      };
    });
    jest.doMock('react-native-css', () => {
      const appState = {
        addEventListener: appStateAddEventListener,
      };

      return {
        __esModule: true,
        AppState: appState,
        default: {
          AppState: appState,
        },
      };
    });

    jest.doMock('../../providers/queryClient', () => ({
      queryClient,
    }));

    jest.doMock('../../storage/SqlitePersister', () => ({
      createSqlitePersister,
    }));

    const queryProviderModule = require('../../providers/QueryProvider') as {
      QueryProvider: QueryProviderHarness['QueryProvider'];
    };
    const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');

    loadedHarness = {
      QueryProvider: queryProviderModule.QueryProvider,
      React,
      TestRenderer,
      addNetInfoEventListener,
      onlineSetEventListener,
      focusSetEventListener,
      appStateAddEventListener,
      persistProviderSpy,
      createSqlitePersister,
      queryClient,
      persister,
    };
  });

  if (!loadedHarness) {
    throw new Error('Failed to load QueryProvider test harness');
  }

  return loadedHarness;
};

const getOnlineListenerFactory = (
  harness: QueryProviderHarness
): ((setOnline: (isOnline: boolean) => void) => () => void) => {
  const factory = harness.onlineSetEventListener.mock.calls[0]?.[0];
  if (typeof factory !== 'function') {
    throw new Error('onlineManager listener factory was not registered');
  }
  return factory as (setOnline: (isOnline: boolean) => void) => () => void;
};

const getFocusListenerFactory = (
  harness: QueryProviderHarness
): ((handleFocus: (isFocused: boolean) => void) => () => void) => {
  const factory = harness.focusSetEventListener.mock.calls[0]?.[0];
  if (typeof factory !== 'function') {
    throw new Error('focusManager listener factory was not registered');
  }
  return factory as (handleFocus: (isFocused: boolean) => void) => () => void;
};

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('QueryProvider', () => {
  it('registers online and focus listeners on module load', () => {
    const harness = loadQueryProviderHarness();

    expect(harness.onlineSetEventListener).toHaveBeenCalledTimes(1);
    expect(harness.focusSetEventListener).toHaveBeenCalledTimes(1);
    expect(harness.createSqlitePersister).toHaveBeenCalledTimes(1);
  });

  it('wires NetInfo state changes into onlineManager', () => {
    const harness = loadQueryProviderHarness();
    const setOnline = jest.fn();
    const unsubscribe = jest.fn();
    harness.addNetInfoEventListener.mockReturnValue(unsubscribe);

    const cleanup = getOnlineListenerFactory(harness)(setOnline);

    expect(harness.addNetInfoEventListener).toHaveBeenCalledTimes(1);
    const netInfoHandler = harness.addNetInfoEventListener.mock.calls[0]?.[0] as (state: {
      isConnected?: boolean | null;
      isInternetReachable?: boolean | null;
    }) => void;

    netInfoHandler({ isConnected: true, isInternetReachable: true });
    netInfoHandler({ isConnected: true, isInternetReachable: false });
    netInfoHandler({ isConnected: false, isInternetReachable: true });

    expect(setOnline).toHaveBeenNthCalledWith(1, true);
    expect(setOnline).toHaveBeenNthCalledWith(2, false);
    expect(setOnline).toHaveBeenNthCalledWith(3, false);

    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('wires AppState changes into focusManager', () => {
    const harness = loadQueryProviderHarness();
    const handleFocus = jest.fn();
    const remove = jest.fn();
    harness.appStateAddEventListener.mockReturnValue({ remove });

    const cleanup = getFocusListenerFactory(harness)(handleFocus);

    expect(harness.appStateAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    const appStateListener = harness.appStateAddEventListener.mock.calls[0]?.[1] as (
      state: string
    ) => void;
    appStateListener('active');
    appStateListener('background');

    expect(handleFocus).toHaveBeenNthCalledWith(1, true);
    expect(handleFocus).toHaveBeenNthCalledWith(2, false);

    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('passes query client and persist options to PersistQueryClientProvider', async () => {
    const harness = loadQueryProviderHarness();
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.QueryProvider,
          null,
          harness.React.createElement('ProviderChild', { testID: 'provider-child' })
        )
      );
    });

    expect(harness.persistProviderSpy).toHaveBeenCalledTimes(1);
    expect(harness.persistProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        client: harness.queryClient,
        persistOptions: {
          persister: harness.persister,
          maxAge: 1000 * 60 * 60 * 24 * 7,
        },
      })
    );
    expect(renderer?.root.findAllByType('ProviderChild')).toHaveLength(1);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
