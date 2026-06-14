type SpyFactory = <T extends (...args: any[]) => any>(implementation?: T) => T;
type ComponentFactory = (name: string) => (props: any) => any;

const noop = () => {};
const noopAsync = async () => {};

const createSpy = <T extends (...args: any[]) => any>(
  spy: SpyFactory,
  implementation: T
): T => spy(implementation);

const createNullComponent: ComponentFactory = () => () => null;

export const asyncStorageData = new Map<string, string>();

export const clearMobileMockState = () => {
  asyncStorageData.clear();
};

export const createAsyncStorageMock = (spy: SpyFactory) => ({
  setItem: createSpy(spy, async (key: string, value: string) => {
    asyncStorageData.set(key, value);
  }),
  getItem: createSpy(spy, async (key: string) => asyncStorageData.get(key) ?? null),
  removeItem: createSpy(spy, async (key: string) => {
    asyncStorageData.delete(key);
  }),
  clear: createSpy(spy, async () => {
    asyncStorageData.clear();
  }),
  getAllKeys: createSpy(spy, async () => Array.from(asyncStorageData.keys())),
  multiGet: createSpy(spy, async (keys: string[]) =>
    keys.map((key) => [key, asyncStorageData.get(key) ?? null])
  ),
  multiSet: createSpy(spy, async (entries: [string, string][]) => {
    for (const [key, value] of entries) {
      asyncStorageData.set(key, value);
    }
  }),
  multiRemove: createSpy(spy, async (keys: string[]) => {
    for (const key of keys) {
      asyncStorageData.delete(key);
    }
  }),
});

export const createSecureStoreMock = (spy: SpyFactory) => {
  const store = new Map<string, string>();
  let available = true;
  return {
    __esModule: true,
    isAvailableAsync: createSpy(spy, async () => available),
    setItemAsync: createSpy(spy, async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: createSpy(spy, async (key: string) => store.get(key) ?? null),
    deleteItemAsync: createSpy(spy, async (key: string) => {
      store.delete(key);
    }),
    _setAvailable: (value: boolean) => {
      available = value;
    },
  };
};

export const createPurchasesMock = (spy: SpyFactory) => ({
  configure: createSpy(spy, noopAsync),
  logIn: createSpy(spy, async () => ({ customerInfo: {} })),
  logOut: createSpy(spy, noopAsync),
  addCustomerInfoUpdateListener: createSpy(spy, () => noop),
  setDebugLogsEnabled: spy(noop),
});

export const createSentryMock = (spy: SpyFactory) => ({
  init: spy(noop),
  captureException: spy(noop),
  captureMessage: spy(noop),
  addBreadcrumb: spy(noop),
  setUser: spy(noop),
  setTag: spy(noop),
  setExtra: spy(noop),
  setContext: spy(noop),
  withScope: createSpy(spy, (callback: any) =>
    callback({
      setLevel: spy(noop),
      setTag: spy(noop),
      setExtra: spy(noop),
      setContext: spy(noop),
      setUser: spy(noop),
    })
  ),
  Native: {
    fetchModules: spy(noop),
    deviceContexts: spy(noop),
  },
});

export const createNetInfoMock = (spy: SpyFactory) => ({
  __esModule: true,
  default: {
    addEventListener: createSpy(spy, () => noop),
    fetch: createSpy(spy, async () => ({ isConnected: true })),
    useNetInfo: () => ({ isConnected: true }),
  },
  addEventListener: createSpy(spy, () => noop),
  useNetInfo: () => ({ isConnected: true }),
});

export const createReactNativeMock = (
  spy: SpyFactory,
  createComponent: ComponentFactory = createNullComponent
) => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();
  const addListener = (event: string, cb: Listener) => {
    const set = listeners.get(event) ?? new Set();
    set.add(cb);
    listeners.set(event, set);
    return { remove: () => set.delete(cb) };
  };
  const Platform = { OS: 'ios', select: (objs: Record<string, unknown>) => objs['ios'] ?? objs['default'] };
  const StyleSheet = { create: (obj: unknown) => obj, flatten: (obj: unknown) => obj };
  const Linking = {
    openURL: createSpy(spy, async () => true),
    canOpenURL: createSpy(spy, async () => true),
    getInitialURL: createSpy(spy, async () => null),
    addEventListener: createSpy(spy, () => ({ remove: spy(noop) })),
  };

  const reactNative = {
    __esModule: true,
    Platform,
    NativeModules: {},
    TurboModuleRegistry: { get: () => null, getEnforcing: () => ({}) },
    NativeEventEmitter: class {
      addListener = addListener;
      removeAllListeners = (event: string) => listeners.delete(event);
    },
    DeviceEventEmitter: { addListener, removeAllListeners: (event: string) => listeners.delete(event) },
    AppRegistry: {
      registerComponent: spy(noop),
      registerRunnable: spy(noop),
      runApplication: spy(noop),
      unmountApplicationComponentAtRootTag: spy(noop),
    },
    AppState: { currentState: 'active', addEventListener: addListener, removeEventListener: noop },
    Alert: { alert: spy(noop) },
    Dimensions: {
      get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
      addEventListener: () => ({ remove: noop }),
    },
    Keyboard: { dismiss: spy(noop), addListener: createSpy(spy, () => ({ remove: spy(noop) })) },
    StatusBar: { setBarStyle: spy(noop), setBackgroundColor: spy(noop) },
    Appearance: {
      getColorScheme: () => 'dark',
      addChangeListener: () => ({ remove: noop }),
      removeChangeListener: noop,
    },
    useColorScheme: () => 'dark',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
    StyleSheet,
    PixelRatio: {
      get: () => 1,
      getFontScale: () => 1,
      getPixelSizeForLayoutSize: (size: number) => size,
      roundToNearestPixel: (size: number) => size,
    },
    LogBox: { ignoreLogs: spy(noop), ignoreAllLogs: spy(noop) },
    Linking,
    Vibration: { vibrate: spy(noop), cancel: spy(noop) },
    Clipboard: { setString: spy(noop), getString: createSpy(spy, async () => '') },
    Share: { share: createSpy(spy, async () => ({ action: 'sharedAction' })), dismissShare: spy(noop) },
    Text: createComponent('Text'),
    View: createComponent('View'),
    Image: Object.assign(createComponent('Image'), { propTypes: {} }),
    ScrollView: createComponent('ScrollView'),
    TouchableOpacity: createComponent('TouchableOpacity'),
    TouchableWithoutFeedback: createComponent('TouchableWithoutFeedback'),
    Pressable: createComponent('Pressable'),
    TextInput: createComponent('TextInput'),
    KeyboardAvoidingView: createComponent('KeyboardAvoidingView'),
    Modal: createComponent('Modal'),
    Switch: createComponent('Switch'),
    ActivityIndicator: createComponent('ActivityIndicator'),
  };
  return { ...reactNative, default: reactNative };
};

export const createExpoConstantsMock = (appOwnership = 'standalone') => ({
  __esModule: true,
  default: {
    appOwnership,
    executionEnvironment: 'standalone',
    expoConfig: { extra: {}, hostUri: undefined },
    manifest: { debuggerHost: undefined, hostUri: undefined },
    manifest2: { extra: { expoGo: { debuggerHost: undefined, hostUri: undefined } } },
    manifestString: null,
    installationId: 'test-installation',
    sessionId: 'test-session',
    expoVersion: '0.0.0-test',
    platform: { ios: {}, android: {}, web: {} },
  },
  AppOwnership: { Expo: 'expo', Standalone: 'standalone' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
});

export const createExpoModulesCoreMock = (spy: SpyFactory) => ({
  __esModule: true,
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => ({}),
  requireNativeView: () => ({}),
  requireNativeViewManager: () => ({}),
  reloadAppAsync: noopAsync,
  registerWebModule: () => ({}),
  createPermissionHook: createSpy(spy, () => () => [{ status: 'granted' }, spy(noop)]),
  Platform: { OS: 'ios', select: (objs: Record<string, unknown>) => objs['ios'] ?? objs['default'] },
  NativeModulesProxy: {},
  EventEmitter: class {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    addListener(event: string, cb: (...args: unknown[]) => void) {
      const set = this.listeners.get(event) ?? new Set();
      set.add(cb);
      this.listeners.set(event, set);
      return { remove: () => set.delete(cb) };
    }
    removeAllListeners(event: string) {
      this.listeners.delete(event);
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => cb(...args));
    }
  },
  SharedObject: class {
    readonly __mockId = 'shared-object';
  },
  SharedRef: class {
    readonly __mockId = 'shared-ref';
  },
  NativeModule: class {
    readonly __mockId = 'native-module';
  },
  CodedError: class CodedError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'CodedError';
    }
  },
  UnavailabilityError: class UnavailabilityError extends Error {
    code = 'ERR_UNAVAILABLE';
    constructor(moduleName: string, propertyName: string) {
      super(`The method or property ${moduleName}.${propertyName} is not available in test environment`);
      this.name = 'UnavailabilityError';
    }
  },
});

export const createExpoCryptoMock = (spy: SpyFactory) => ({
  __esModule: true,
  randomUUID: createSpy(spy, () => 'mock-uuid-0000-0000-0000-000000000000'),
  getRandomBytes: (size: number) => new Uint8Array(size),
  getRandomBytesAsync: async (size: number) => new Uint8Array(size),
  digestStringAsync: createSpy(spy, async (_algorithm: string, data: string) => data),
  AesCryptoModule: { EncryptionKey: class MockEncryptionKey { id = 'mock-key'; } },
});

export const createExpoNotificationsMock = (spy: SpyFactory) => ({
  AndroidImportance: { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 },
  getPermissionsAsync: createSpy(spy, async () => ({ status: 'undetermined', canAskAgain: true, granted: false })),
  requestPermissionsAsync: createSpy(spy, async () => ({ status: 'granted', canAskAgain: false, granted: true })),
  getExpoPushTokenAsync: createSpy(spy, async () => ({ type: 'expo', data: 'ExponentPushToken[mock-token-123]' })),
  setNotificationChannelAsync: createSpy(spy, async () => null),
  setNotificationHandler: spy(noop),
  setNotificationCategoryAsync: createSpy(spy, async () => null),
  addNotificationReceivedListener: createSpy(spy, () => ({ remove: spy(noop) })),
  addNotificationResponseReceivedListener: createSpy(spy, () => ({ remove: spy(noop) })),
});

export const createSvgMock = (createComponent: ComponentFactory = createNullComponent) => ({
  __esModule: true,
  default: createComponent('Svg'),
  Svg: createComponent('Svg'),
  Path: createComponent('Path'),
  Circle: createComponent('Circle'),
  Rect: createComponent('Rect'),
  G: createComponent('G'),
  Polyline: createComponent('Polyline'),
  Line: createComponent('Line'),
  Polygon: createComponent('Polygon'),
});

export const createSseMock = (spy: SpyFactory) =>
  class MockEventSource {
    addEventListener = spy(noop);
    removeEventListener = spy(noop);
    removeAllEventListeners = spy(noop);
    close = spy(noop);
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    constructor(public url?: string) {}
    emit(event: 'open' | 'error' | 'message', payload?: { data?: unknown }) {
      if (event === 'open') this.onopen?.();
      if (event === 'error') this.onerror?.(payload);
      if (event !== 'message') return;
      if (typeof payload?.data !== 'string') {
        this.onerror?.(new Error('Invalid message payload'));
        return;
      }
      this.onmessage?.({ data: payload.data });
    }
  };

export const createExpoSqliteMock = (spy: SpyFactory) => {
  const tableData = new Map<string, any[]>();
  const readTableName = (sql: string) => {
    const lowerSql = sql.toLowerCase();
    if (lowerSql.includes('from "')) return sql.split('from "')[1]?.split('"')[0] ?? 'unknown';
    if (lowerSql.includes('into "')) return sql.split('into "')[1]?.split('"')[0] ?? 'unknown';
    return 'unknown';
  };
  const prepareSync = (sql: string) => {
    const lowerSql = sql.toLowerCase();
    const tableName = readTableName(sql);
    return {
      run: spy(() => ({})),
      all: spy(() => []),
      raw: spy(() => []),
      getColumnNames: spy(() => []),
      executeSync: spy((params?: any) => {
        if (lowerSql.startsWith('insert')) {
          const rows = tableData.get(tableName) ?? [];
          rows.push(params);
          tableData.set(tableName, rows);
        }
        if (lowerSql.startsWith('delete')) tableData.set(tableName, []);
        return { changes: 1, lastInsertRowId: 1, rows: { length: 0, item: () => null } };
      }),
      executeForRawResultSync: spy(() => ({ getAllSync: () => tableData.get(tableName) ?? [] })),
      finalizeSync: spy(noop),
    };
  };
  const db = {
    execAsync: spy(noopAsync),
    prepareSync,
    runSync: spy(() => ({ changes: 1, lastInsertRowId: 1 })),
    getAllSync: spy(() => []),
    getFirstSync: spy(() => null),
    getAllAsync: spy(async () => []),
    getFirstAsync: spy(async () => null),
    runAsync: spy(async () => ({ rowsAffected: 0 })),
    transaction: (cb: any) => cb({ executeSql: (_sql: string, _params: unknown[], onSuccess?: any) => onSuccess?.({ rows: { length: 0, item: () => null } }) }),
    close: spy(noop),
  };
  return {
    __esModule: true,
    openDatabase: spy(() => db),
    openDatabaseSync: spy(() => db),
    default: { openDatabase: () => db },
    defaultDatabaseDirectory: '/tmp',
    addDatabaseChangeListener: spy(() => ({ remove: spy(noop) })),
    removeDatabaseChangeListener: spy(noop),
  };
};
