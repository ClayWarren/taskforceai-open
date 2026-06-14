import { jest as bunJest, mock } from 'bun:test';

import {
  createAsyncStorageMock,
  createExpoConstantsMock,
  createExpoCryptoMock,
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

const mockJest = {
  ...bunJest,
  isolateModules: (fn: () => void) => fn(),
  doMock: (specifier: string, factory: () => any) => mock.module(specifier, factory),
  requireMock: (specifier: string) => require(specifier),
  fn: bunJest.fn,
  spyOn: bunJest.spyOn,
  clearAllMocks: bunJest.clearAllMocks,
  resetModules: () => {},
};

(globalThis as any).jest = mockJest;
(globalThis as any).registerTestMock = (specifier: string, factory: () => any) => {
  mock.module(specifier, factory);
};

const spy = <T extends (...args: any[]) => any>(implementation?: T): T => bunJest.fn(implementation) as T;
const noopLogger = () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

mock.module('react-native', () => createReactNativeMock(spy));
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
mock.module('@react-native-voice/voice', () => ({
  __esModule: true,
  default: {
    getSpeechRecognitionServices: async () => [],
    removeAllListeners: () => {},
    cancel: async () => {},
    start: async () => {},
  },
}));
mock.module('expo-sqlite', () => createExpoSqliteMock(spy));
mock.module('expo-modules-core', () => createExpoModulesCoreMock(spy));
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

mock.module('@taskforceai/contracts/client', () => ({
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

mock.module('@taskforceai/contracts/auth', () => ({
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
