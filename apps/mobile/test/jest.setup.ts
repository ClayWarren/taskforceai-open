import { jest } from '@jest/globals';
import mockReact from 'react';
import { configureClientIdFactory } from '@taskforceai/client-runtime';

let testId = 0;
configureClientIdFactory((prefix) => `${prefix}-test-${++testId}`);

import {
  clearMobileMockState,
  createAsyncStorageMock as mockCreateAsyncStorageMock,
  createExpoConstantsMock as mockCreateExpoConstantsMock,
  createExpoCryptoMock as mockCreateExpoCryptoMock,
  createExpoFileSystemMock as mockCreateExpoFileSystemMock,
  createExpoModulesCoreMock as mockCreateExpoModulesCoreMock,
  createExpoNotificationsMock as mockCreateExpoNotificationsMock,
  createExpoSqliteMock as mockCreateExpoSqliteMock,
  createPurchasesMock as mockCreatePurchasesMock,
  createReactNativeMock as mockCreateReactNativeMock,
  createSecureStoreMock as mockCreateSecureStoreMock,
  createSentryMock as mockCreateSentryMock,
  createSvgMock as mockCreateSvgMock,
  createSseMock as mockCreateSseMock,
} from './mobile-mock-factories';

const OriginalMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class PatchedMessageChannel extends OriginalMessageChannel {
  constructor() {
    super();
    this.port1.unref();
    this.port2.unref();
  }
} as typeof MessageChannel;

(globalThis as any).XMLHttpRequest = class XMLHttpRequest {
  open() {}
  send() {}
  setRequestHeader() {}
  abort() {}
  addEventListener() {}
  removeEventListener() {}
} as any;

(globalThis as any).__DEV__ = false;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockSpy = <T extends (...args: any[]) => any>(implementation?: T): T =>
  jest.fn(implementation as any) as any;
const mockCreateReactComponent = (name: string) => (props: any) => {
  return mockReact.createElement(name, props, props.children);
};

const mockDatabaseMetadata = new Map<string, string>();
const mockAsyncStorage = mockCreateAsyncStorageMock(mockSpy);
const mockAsyncStorageClear = mockAsyncStorage.clear;
mockAsyncStorage.clear = mockSpy(async () => {
  await mockAsyncStorageClear();
  mockDatabaseMetadata.clear();
});
const mockAsyncStorageModule = { __esModule: true, default: mockAsyncStorage, ...mockAsyncStorage };
const mockExpoFileSystem = Object.assign(mockCreateExpoFileSystemMock(), {
  downloadAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  moveAsync: jest.fn(),
  copyAsync: jest.fn(),
  documentDirectory: 'file:///mock-dir/',
  cacheDirectory: 'file:///mock-cache/',
});
Reflect.deleteProperty(mockExpoFileSystem, '__esModule');

jest.mock('react-native', () => mockCreateReactNativeMock(mockSpy, mockCreateReactComponent));
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorageModule);
jest.mock('expo-secure-store', () => mockCreateSecureStoreMock(mockSpy));
jest.mock('react-native-purchases', () => mockCreatePurchasesMock(mockSpy));
jest.mock('expo-sqlite', () => mockCreateExpoSqliteMock(mockSpy));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: jest.fn() }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: jest.fn() }));
jest.mock('../src/storage/database-manager', () => ({
  dbManager: {
    ensureRawDb: async () => ({
      getFirstAsync: async (_sql: string, params: unknown[]) => {
        const key = String(params[0]);
        const value = mockDatabaseMetadata.get(key);
        return value === undefined ? null : { key, value };
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('INSERT')) {
          mockDatabaseMetadata.set(String(params?.[0]), String(params?.[1]));
        } else if (sql.startsWith('DELETE')) {
          mockDatabaseMetadata.delete(String(params?.[0]));
        }
      },
    }),
  },
}));
jest.mock('expo-crypto', () => mockCreateExpoCryptoMock(mockSpy));
jest.mock('expo', () => ({
  __esModule: true,
  requireNativeModule: jest.fn(() => ({})),
  requireOptionalNativeModule: jest.fn(() => ({})),
  requireNativeViewManager: jest.fn(() => ({})),
  default: {
    requireNativeModule: jest.fn(() => ({})),
    requireOptionalNativeModule: jest.fn(() => ({})),
    requireNativeViewManager: jest.fn(() => ({})),
  },
}));
jest.mock('expo-modules-core', () => mockCreateExpoModulesCoreMock(mockSpy));
jest.mock('expo-notifications', () => mockCreateExpoNotificationsMock(mockSpy));
jest.mock('expo-audio', () => ({
  RecordingPresets: {
    HIGH_QUALITY: { extension: '.m4a' },
  },
  createAudioPlayer: jest.fn(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    pause: jest.fn(),
    play: jest.fn(),
    remove: jest.fn(),
  })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioStream: jest.fn(() => ({
    isStreaming: false,
    stream: {
      id: 'mock-audio-stream',
      start: jest.fn(async () => {}),
      stop: jest.fn(),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
    },
  })),
}));
jest.mock('expo-audio/build/AudioModule', () => ({
  __esModule: true,
  default: {
    AudioRecorder: class {
      uri: string | null = 'file:///tmp/recording.m4a';
      async prepareToRecordAsync() {}
      record() {}
      async stop() {}
    },
  },
}));
const mockSpeechRecognitionListeners = new Map<string, Set<(event?: any) => void>>();
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    addListener: jest.fn((event: string, listener: (event?: any) => void) => {
      const listeners = mockSpeechRecognitionListeners.get(event) ?? new Set();
      listeners.add(listener);
      mockSpeechRecognitionListeners.set(event, listeners);
      return {
        remove: jest.fn(() => listeners.delete(listener)),
      };
    }),
    getSpeechRecognitionServices: jest.fn(() => []),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    isRecognitionAvailable: jest.fn(() => true),
    abort: jest.fn(),
    stop: jest.fn(),
    start: jest.fn(() => {
      queueMicrotask(() => {
        for (const listener of mockSpeechRecognitionListeners.get('result') ?? []) {
          listener({
            isFinal: true,
            results: [{ transcript: 'mock transcript' }],
          });
        }
      });
    }),
  },
}));
jest.mock('@sentry/react-native', () => mockCreateSentryMock(mockSpy));
jest.mock('expo-constants', () => mockCreateExpoConstantsMock());
jest.mock('react-native-svg', () => mockCreateSvgMock(mockCreateReactComponent));
jest.mock('react-native-sse', () => mockCreateSseMock(mockSpy));
jest.mock('expo-file-system', () => mockExpoFileSystem);
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

const mockActualQuery = jest.requireActual('@tanstack/react-query');
const mockTestRenderer = jest.requireActual<typeof import('react-test-renderer')>(
  'react-test-renderer'
);
mockActualQuery.notifyManager.setNotifyFunction((fn: any) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockTestRenderer.act(() => {
    fn();
  });
});

const mockActiveClients = new Set<any>();

jest.mock('@tanstack/react-query', () => {
  class MockQueryClient extends mockActualQuery.QueryClient {
    constructor(config: any) {
      super(config);
      mockActiveClients.add(this);
    }
  }

  const useMutationPatched = (options: any) => {
    const mutation = mockActualQuery.useMutation(options);
    const original = mutation.mutateAsync;
    mutation.mutateAsync = async (...args: any[]) => {
      try {
        return await original(...args);
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    };
    return mutation;
  };

  return { ...mockActualQuery, QueryClient: MockQueryClient, useMutation: useMutationPatched };
});

if (typeof afterEach === 'function') {
  afterEach(() => {
    mockActiveClients.forEach((client) => client.clear());
    mockActiveClients.clear();
    mockDatabaseMetadata.clear();
  });
}

jest.mock('expo-linear-gradient', () => {
  const MockLinearGradient = ({ children, ...props }: any) =>
    mockReact.createElement('LinearGradient', props, children);
  return { LinearGradient: MockLinearGradient, default: MockLinearGradient };
});

jest.mock('lucide-react-native', () => {
  const Icon = (props: any) => mockReact.createElement('Icon', props);
  const iconNames =
    'Activity ArrowUpRight AudioLines ChevronDown ChevronUp Clock Copy Check Settings LogOut Gauge Globe Sun Moon Monitor MessageSquare Plus Trash2 MoreVertical Send Mic StopCircle Info AlertTriangle RefreshCw ExternalLink Menu Sparkles Zap X'.split(
      ' '
    );
  return {
    createLucideIcon: jest.fn(() => Icon),
    ...Object.fromEntries(iconNames.map((name) => [name, Icon])),
  };
});

jest.mock('react-native-css', () => {
  const MockComponent = (name: string) => {
    const Component = mockCreateReactComponent(name);
    Component.displayName = name;
    return Component;
  };
  const components =
    'TouchableOpacity Pressable KeyboardAvoidingView Text View ActivityIndicator Image ImageBackground ScrollView TextInput Modal'.split(
      ' '
    );
  return {
    useCssElement: () => null,
    useCss: () => ({}),
    ...Object.fromEntries(components.map((name) => [name, MockComponent(name)])),
    Platform: { OS: 'ios', select: (objs: any) => objs.ios || objs.default },
    StyleSheet: { create: (obj: any) => obj, flatten: (obj: any) => obj },
    Alert: { alert: jest.fn() },
    Keyboard: { dismiss: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) },
    Linking: {
      openURL: jest.fn().mockResolvedValue(true as never),
      canOpenURL: jest.fn().mockResolvedValue(true as never),
      getInitialURL: jest.fn().mockResolvedValue(null as never),
      addEventListener: jest.fn(),
    },
    useWindowDimensions: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
    LayoutAnimation: { configureNext: jest.fn(), Presets: { easeInEaseOut: {} } },
    Animated: {
      View: MockComponent('Animated.View'),
      Text: MockComponent('Animated.Text'),
      createAnimatedComponent: (component: any) => component,
      Value: () => ({ interpolate: () => ({}), setValue: () => {} }),
      timing: () => ({ start: () => {} }),
      spring: () => ({ start: () => {} }),
    },
  };
});

jest.mock('nativewind', () => ({
  styled: (Component: any) => Component,
  useColorScheme: () => ({
    colorScheme: 'dark',
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  return {
    SafeAreaProvider: ({ children }: any) => children,
    SafeAreaView: ({ children }: any) => mockReact.createElement('View', {}, children),
    useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
    useSafeAreaFrame: jest.fn(() => ({ x: 0, y: 0, width: 390, height: 844 })),
  };
});

export const registerTestMock = (specifier: string, factoryOrValue: unknown): void => {
  const mockFactory =
    typeof factoryOrValue === 'function' ? (factoryOrValue as () => unknown) : () => factoryOrValue;

  try {
    jest.doMock(specifier, () => mockFactory());
  } catch {
    jest.mock(specifier, () => mockFactory());
  }
};

export const resetTestMocks = () => {
  jest.resetModules();
  jest.clearAllMocks();
  clearMobileMockState();
};

declare global {
  var registerTestMock: (specifier: string, factoryOrValue: unknown) => void;
  var resetTestMocks: () => void;
  var AsyncStorage: typeof mockAsyncStorage;
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.registerTestMock = registerTestMock;
globalThis.resetTestMocks = resetTestMocks;
globalThis.AsyncStorage = mockAsyncStorage;

export const __jestSetupModule = true;
