import { afterEach, describe, expect, it, jest } from '@jest/globals';

type AppOwnership = 'expo' | 'standalone' | 'guest';
type PlatformOS = 'ios' | 'android';

type AppProvidersHarness = {
  AppProviders: (props: { children: unknown }) => unknown;
  React: typeof import('react');
  TestRenderer: typeof import('react-test-renderer');
  renderOrder: string[];
  incrementCounter: jest.Mock;
  setNotificationHandler: jest.Mock;
  syncProvider: jest.Mock;
  useNotificationsBootstrap: jest.Mock;
};

type AppProvidersHarnessOptions = {
  fontsReady?: boolean;
  appOwnership?: AppOwnership;
  platformOS?: PlatformOS;
  autoSyncEnabled?: boolean;
};

const flushEffects = async (
  act: typeof import('react-test-renderer').act
): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const makePassThroughProvider = (
  React: typeof import('react'),
  renderOrder: string[],
  name: string
): jest.Mock =>
  jest.fn(({ children }: { children?: unknown }) => {
    renderOrder.push(name);
    return React.createElement(React.Fragment, null, children);
  });

const loadAppProvidersHarness = (
  options: AppProvidersHarnessOptions = {}
): AppProvidersHarness => {
  const {
    fontsReady = true,
    appOwnership = 'standalone',
    platformOS = 'ios',
    autoSyncEnabled = true,
  } = options;

  jest.resetModules();

  let loadedHarness: AppProvidersHarness | null = null;

  jest.isolateModules(() => {
    const React = require('react') as typeof import('react');
    const renderOrder: string[] = [];
    const expoGoOwnershipValue = '__expo_go__';

    const incrementCounter = jest.fn();
    const setNotificationHandler = jest.fn();
    const useNotificationsBootstrap = jest.fn();
    const setVoiceAdapter = jest.fn();

    const ErrorBoundary = makePassThroughProvider(React, renderOrder, 'ErrorBoundary');
    const LanguageProvider = makePassThroughProvider(React, renderOrder, 'LanguageProvider');
    const PreferencesProvider = makePassThroughProvider(React, renderOrder, 'PreferencesProvider');
    const ThemeProvider = makePassThroughProvider(React, renderOrder, 'ThemeProvider');
    const SafeAreaProvider = makePassThroughProvider(React, renderOrder, 'SafeAreaProvider');
    const QueryProvider = makePassThroughProvider(React, renderOrder, 'QueryProvider');
    const AuthProvider = makePassThroughProvider(React, renderOrder, 'AuthProvider');
    const syncProvider = makePassThroughProvider(React, renderOrder, 'SyncProvider');

    jest.doMock('../../../nativewind.generated.css', () => ({}), { virtual: true });
    const mockReactNativeModule = () => {
      const RuntimeReact = require('react') as typeof import('react');
      const createHostComponent =
        (name: string) =>
        ({ children, ...props }: { children?: unknown }) =>
          RuntimeReact.createElement(name, props, children);
      const appStateSubscription = { remove: jest.fn() };

      return {
        __esModule: true,
        Platform: {
          OS: platformOS,
          select: (choices: Record<string, unknown>) => choices[platformOS] ?? choices.default,
        },
        StyleSheet: {
          create: <T,>(styles: T) => styles,
        },
        View: createHostComponent('View'),
        ActivityIndicator: createHostComponent('ActivityIndicator'),
        AppState: {
          addEventListener: jest.fn(() => appStateSubscription),
        },
      };
    };

    jest.doMock('react-native', () => {
      const module = mockReactNativeModule();
      return {
        ...module,
        default: module,
      };
    });
    jest.doMock('react-native-css', () => {
      const module = mockReactNativeModule();
      return {
        ...module,
        default: module,
      };
    });

    jest.doMock('expo-constants', () => {
      const appOwnershipValue = appOwnership === 'expo' ? expoGoOwnershipValue : appOwnership;
      const appOwnershipEnum = {
        Expo: expoGoOwnershipValue,
        Standalone: 'standalone',
        Guest: 'guest',
      };

      return {
        __esModule: true,
        AppOwnership: appOwnershipEnum,
        appOwnership: appOwnershipValue,
        default: {
          appOwnership: appOwnershipValue,
          AppOwnership: appOwnershipEnum,
        },
      };
    });

    jest.doMock('expo-notifications', () => ({
      setNotificationHandler,
    }));

    jest.doMock('@taskforceai/voice', () => ({
      isVoiceCancellationError: () => false,
      voiceManager: {
        setAdapter: setVoiceAdapter,
      },
    }));

    jest.doMock('../../voice/mobileAdapter', () => ({
      MobileVoiceAdapter: function MobileVoiceAdapter() {},
    }));

    jest.doMock('../../observability/metrics', () => ({
      mobileMetrics: {
        incrementCounter,
      },
    }));

    jest.doMock('../../components/ErrorBoundary', () => ({
      ErrorBoundary,
    }));

    jest.doMock('../../contexts/LanguageContext', () => ({
      LanguageProvider,
    }));

    jest.doMock('../../contexts/PreferencesContext', () => ({
      PreferencesProvider,
      usePreferences: () => ({ autoSyncEnabled }),
    }));

    jest.doMock('../../contexts/ThemeContext', () => ({
      ThemeProvider,
    }));

    jest.doMock('react-native-safe-area-context', () => ({
      SafeAreaProvider,
    }));

    jest.doMock('../../providers/QueryProvider', () => ({
      QueryProvider,
    }));

    jest.doMock('../../contexts/AuthContext', () => ({
      AuthProvider,
    }));

    jest.doMock('../../contexts/SyncContext', () => ({
      SyncProvider: syncProvider,
    }));

    jest.doMock('../../hooks/useCacheCleanup', () => ({
      useCacheCleanup: jest.fn(),
    }));

    jest.doMock('../../streaming/useStreamingStore', () => ({
      useStreamingAutoAbort: jest.fn(),
    }));

    jest.doMock('../../hooks/useNotificationsBootstrap', () => ({
      useNotificationsBootstrap,
    }));

    jest.doMock('../../theme/useTypography', () => ({
      useTypography: () => fontsReady,
    }));

    jest.doMock('../../storage/sqlite-adapter', () => ({
      sqliteStorage: {
        getSession: jest.fn(async () => ({ ok: false, error: new Error('missing session') })),
      },
    }));

    jest.doMock('../../config/base-url', () => ({
      getMobileBaseUrl: () => 'https://api.test',
    }));

    jest.doMock('../../api/client', () => ({
      getMobileClient: () => ({ id: 'mock-mobile-client' }),
      getMobilePinnedFetch: () => jest.fn(),
    }));

    jest.doMock('@taskforceai/api-client/auth/auth-client', () => ({
      authClient: {
        configure: jest.fn(),
      },
    }));

    jest.doMock('@taskforceai/api-client/browserClient', () => ({
      setBrowserClient: jest.fn(),
    }));

    const appProvidersModule = require('../../providers/AppProviders') as {
      default: AppProvidersHarness['AppProviders'];
    };
    const TestRenderer = require('react-test-renderer') as typeof import('react-test-renderer');

    loadedHarness = {
      AppProviders: appProvidersModule.default,
      React,
      TestRenderer,
      renderOrder,
      incrementCounter,
      setNotificationHandler,
      syncProvider,
      useNotificationsBootstrap,
    };
  });

  if (!loadedHarness) {
    throw new Error('Failed to load AppProviders test harness');
  }

  return loadedHarness;
};

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('AppProviders', () => {
  it('reports startup metrics when mounted', async () => {
    const harness = loadAppProvidersHarness();
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.AppProviders,
          null,
          harness.React.createElement('ChildMarker', { testID: 'child' })
        )
      );
    });

    await flushEffects(act);

    expect(harness.incrementCounter).toHaveBeenCalledTimes(4);
    expect(harness.incrementCounter).toHaveBeenCalledWith(
      'app.start.duration',
      expect.objectContaining({ duration_ms: expect.any(Number) })
    );
    expect(harness.incrementCounter).toHaveBeenCalledWith('app.start.success');
    expect(harness.incrementCounter).toHaveBeenCalledWith(
      'app.start.interactive',
      expect.objectContaining({ duration_ms: expect.any(Number) })
    );
    expect(harness.incrementCounter).toHaveBeenCalledWith('app.start.fonts_ready');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('skips notification handler setup on Expo Go Android', async () => {
    const harness = loadAppProvidersHarness({
      appOwnership: 'expo',
      platformOS: 'android',
    });
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.AppProviders,
          null,
          harness.React.createElement('ChildMarker')
        )
      );
    });

    await flushEffects(act);
    expect(harness.setNotificationHandler).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('configures the notification handler outside Expo Go Android', async () => {
    const harness = loadAppProvidersHarness({
      appOwnership: 'standalone',
      platformOS: 'android',
    });
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.AppProviders,
          null,
          harness.React.createElement('ChildMarker')
        )
      );
    });

    await flushEffects(act);

    expect(harness.setNotificationHandler).toHaveBeenCalledTimes(1);
    const handlerConfig = harness.setNotificationHandler.mock.calls[0]?.[0] as {
      handleNotification: () => Promise<Record<string, boolean>>;
    };
    const resolvedHandler = await handlerConfig.handleNotification();
    expect(resolvedHandler).toEqual({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('renders loading state until fonts are ready', async () => {
    const harness = loadAppProvidersHarness({ fontsReady: false });
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.AppProviders,
          null,
          harness.React.createElement('ChildMarker', { testID: 'child' })
        )
      );
    });

    await flushEffects(act);

    expect(renderer?.root.findAllByType('ActivityIndicator')).toHaveLength(1);
    expect(renderer?.root.findAllByType('ChildMarker')).toHaveLength(0);
    expect(harness.syncProvider).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('composes providers in order and wires sync from preferences', async () => {
    const harness = loadAppProvidersHarness({ autoSyncEnabled: false });
    const { act, create } = harness.TestRenderer;

    let renderer: import('react-test-renderer').ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        harness.React.createElement(
          harness.AppProviders,
          null,
          harness.React.createElement('ChildMarker', { testID: 'child' })
        )
      );
    });

    await flushEffects(act);

    expect(renderer?.root.findAllByType('ChildMarker')).toHaveLength(1);
    expect(harness.useNotificationsBootstrap).toHaveBeenCalledTimes(1);
    expect(harness.syncProvider).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      undefined
    );

    const expectedOrder = [
      'ErrorBoundary',
      'LanguageProvider',
      'PreferencesProvider',
      'ThemeProvider',
      'SafeAreaProvider',
      'QueryProvider',
      'AuthProvider',
      'SyncProvider',
    ];

    let cursor = -1;
    for (const providerName of expectedOrder) {
      const index = harness.renderOrder.indexOf(providerName);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }

    await act(async () => {
      renderer?.unmount();
    });
  });
});
