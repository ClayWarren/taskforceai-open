import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest as bunJest,
  mock,
  test,
} from 'bun:test';
import React from 'react';
import { configureClientIdFactory } from '@taskforceai/client-runtime';

import {
  createAsyncStorageMock,
  createExpoConstantsMock,
  createExpoCryptoMock,
  createExpoFileSystemMock,
  createExpoModulesCoreMock,
  createExpoSqliteMock,
  createNetInfoMock,
  createReactNativeMock,
  createSecureStoreMock,
  createSentryMock,
  createSvgMock,
  createSseMock,
} from './mobile-mock-factories';

(globalThis as any).__DEV__ = true;
process.env['BUN_TEST'] = '1';

let testId = 0;
configureClientIdFactory((prefix) => `${prefix}-test-${++testId}`);

(bunJest as any).requireActual = (specifier: string) => require(specifier);
(bunJest as any).requireMock = (specifier: string) => require(specifier);

const mockJest = {
  ...bunJest,
  isolateModules: (fn: () => void) => fn(),
  doMock: (specifier: string, factory: () => any) => mock.module(specifier, factory),
  requireMock: (specifier: string) => require(specifier),
  requireActual: (specifier: string) => require(specifier),
  fn: bunJest.fn,
  spyOn: bunJest.spyOn,
  clearAllMocks: bunJest.clearAllMocks,
  resetModules: () => {},
};

(globalThis as any).jest = mockJest;
(globalThis as any).registerTestMock = (specifier: string, factory: () => any) => {
  mock.module(specifier, factory);
};
mock.module('@jest/globals', () => ({
  __esModule: true,
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest: mockJest,
  test,
}));

const spy = <T extends (...args: any[]) => any>(implementation?: T): T => bunJest.fn(implementation) as T;
const createReactComponent = (name: string) => (props: any) =>
  React.createElement(name, props, props.children);
const noopLogger = () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

mock.module('react-native', () => createReactNativeMock(spy, createReactComponent));
mock.module('@sentry/react-native', () => createSentryMock(spy));
mock.module('@react-native-community/netinfo', () => createNetInfoMock(spy));
mock.module('react-native-svg', () => createSvgMock());
mock.module('expo', () => ({
  __esModule: true,
  default: {},
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => ({}),
}));
mock.module('expo-constants', () => createExpoConstantsMock());
mock.module('expo-speech', () => ({
  __esModule: true,
  speak: (_text: string, options?: { onDone?: () => void }) => options?.onDone?.(),
  stop: async () => {},
}));
mock.module('@expo-google-fonts/inter', () => ({
  __esModule: true,
  Inter_400Regular: 'Inter_400Regular',
  Inter_500Medium: 'Inter_500Medium',
  Inter_600SemiBold: 'Inter_600SemiBold',
  Inter_700Bold: 'Inter_700Bold',
}));
mock.module('expo-audio', () => ({
  __esModule: true,
  RecordingPresets: {
    HIGH_QUALITY: { extension: '.m4a' },
  },
  createAudioPlayer: spy(() => ({
    addListener: () => ({ remove: () => {} }),
    pause: () => {},
    play: () => {},
    remove: () => {},
  })),
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: async () => {},
  useAudioStream: () => ({
    isStreaming: false,
    stream: {
      id: 'mock-audio-stream',
      start: async () => {},
      stop: () => {},
      addListener: () => ({ remove: () => {} }),
    },
  }),
}));
mock.module('expo-audio/build/AudioModule', () => ({
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
const speechRecognitionListeners = new Map<string, Set<(event?: any) => void>>();
mock.module('expo-speech-recognition', () => ({
  __esModule: true,
  ExpoSpeechRecognitionModule: {
    addListener: (event: string, listener: (event?: any) => void) => {
      const listeners = speechRecognitionListeners.get(event) ?? new Set();
      listeners.add(listener);
      speechRecognitionListeners.set(event, listeners);
      return {
        remove: () => listeners.delete(listener),
      };
    },
    getSpeechRecognitionServices: () => [],
    requestPermissionsAsync: async () => ({ granted: true }),
    isRecognitionAvailable: () => true,
    abort: () => {},
    stop: () => {},
    start: () => {
      queueMicrotask(() => {
        for (const listener of speechRecognitionListeners.get('result') ?? []) {
          listener({
            isFinal: true,
            results: [{ transcript: 'mock transcript' }],
          });
        }
      });
    },
  },
}));
mock.module('expo-sqlite', () => createExpoSqliteMock(spy));
mock.module('expo-modules-core', () => createExpoModulesCoreMock(spy));
mock.module('expo-file-system', () => createExpoFileSystemMock());
mock.module('expo-crypto', () => createExpoCryptoMock(spy));
mock.module('expo-secure-store', () => createSecureStoreMock(spy));
mock.module('@react-native-async-storage/async-storage', () => {
  const storage = createAsyncStorageMock(spy);
  return { __esModule: true, default: storage, ...storage };
});
mock.module('react-native-sse', () => ({
  __esModule: true,
  default: createSseMock(spy),
}));

try {
  const sqliteInternalPath = require.resolve('../src/storage/sqlite-adapter.internal');
  const sqlitePath = require.resolve('../src/storage/sqlite-adapter');
  const sqliteMock = {
    sqliteStorage: {
      getPendingChanges: async () => [],
      getDeviceId: async () => 'test-device',
      getLastSyncVersion: async () => 0,
      setLastSyncVersion: async () => {},
      clearChatData: async () => {},
      clearAll: async () => {},
    },
    SQLiteStorageAdapter: class {},
  };
  mock.module(sqliteInternalPath, () => sqliteMock);
  mock.module(sqlitePath, () => sqliteMock);
} catch {
  // src might not exist in all environments.
}

const mockController = {
  apiClient: { id: 'mock-api-client', config: {} as any, label: 'rebuilt' },
  authClient: { id: 'mock-auth-client', apiClient: null as any, label: 'rebuilt' },
  createApiClient: mock((config: any) => {
    mockController.apiClient.config = config;
    return mockController.apiClient;
  }),
  createAuthClient: mock((config: any) => {
    mockController.authClient.apiClient = config?.apiClient;
    return mockController.authClient;
  }),
};

(globalThis as any).__TEST_MOCKS__ = mockController;

mock.module('@taskforceai/api-client/client', () => ({
  ApiClientError: class ApiClientError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.body = body;
    }
  },
  createApiClient: (config: any) => mockController.createApiClient(config),
}));

mock.module('@taskforceai/api-client/auth', () => ({
  createAuthClient: (config: any) => mockController.createAuthClient(config),
}));

mock.module('../src/logger', () => ({
  mobileLogger: { ...noopLogger(), child: noopLogger },
  createModuleLogger: noopLogger,
}));

(globalThis as any).expo = {
  EventEmitter: class {
    addListener = () => ({ remove: () => {} });
    removeAllListeners = () => {};
  },
};
