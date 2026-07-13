/* c8 ignore file */
/* istanbul ignore file */
/**
 * Note: Core package is now Go. Orchestration tests should use the Go /api/run endpoint.
 * This setup file provides minimal mocks for remaining TS tests.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, mock, vi } from 'bun:test';
import { config } from 'dotenv';
import { resolve } from 'path';

import {
  createCookieProxy,
  mockAnchorClicks,
  mockRadixDismissableLayer,
  mockWindowLocation,
  patchFetch as sharedPatchFetch,
  patchScreenBindings as sharedPatchScreenBindings,
  polyfillAnimationFrame,
  polyfillLegacyElementEvents,
  setGlobal,
  setupDomGlobals,
  setupMatchers,
} from './setup/shared';

import {
  createAsyncStorageMock,
  createExpoConstantsMock,
  createExpoModulesCoreMock,
  createExpoSqliteMock,
  createReactNativeMock,
  createSecureStoreMock,
  createSseMock,
} from '../apps/mobile/test/mobile-mock-factories';
import * as expoModulesCorePolyfillMock from '../apps/mobile/test/mocks/expo-modules-core-polyfill';

// React 19 requires this flag for act() warnings
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
  var registerTestMock: (specifier: string, factoryOrValue: unknown) => void;
  var resetTestMocks: () => void;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// Set critical environment variables BEFORE loading dotenv or any modules
const assignEnv = (vars: Record<string, string>) => {
  process.env = { ...process.env, ...vars } as NodeJS.ProcessEnv;
};

// Signal to app code that Bun test stubs can be used
assignEnv({ BUN_TEST: '1' });

const registeredModuleMocks = new Map<string, () => unknown>();

const isFactory = (value: unknown): value is () => unknown => typeof value === 'function';

globalThis.registerTestMock = (specifier: string, factoryOrValue: unknown) => {
  const factory = isFactory(factoryOrValue) ? factoryOrValue : () => factoryOrValue;
  registeredModuleMocks.set(specifier, factory);
  mock.module(specifier, factory);
};

globalThis.resetTestMocks = () => {
  // Re-apply any registered module mocks to ensure they remain active
  for (const [id, factory] of registeredModuleMocks.entries()) {
    mock.module(id, factory);
  }
  // Clear call history without dropping module mocks wired above
  vi.clearAllMocks();
};

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

let domWindow: Window | undefined;
let domDocument: Document | undefined;
let documentProxy: Document | undefined;

const ensureDomBindings = (): void => {
  if (domWindow && documentProxy) {
    return;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  domWindow = window as unknown as Window;
  domDocument = document;
  documentProxy = document;
};

if (hasDom) {
  domWindow = window as unknown as Window;
  domDocument = document;
  const { proxy } = createCookieProxy(domDocument);
  documentProxy = proxy;
  setupDomGlobals(domWindow, documentProxy);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

polyfillLegacyElementEvents();
polyfillAnimationFrame();

// -----------------------------
// React Native / Expo core mocks
// -----------------------------
const globalRecord = globalThis as Record<string, unknown>;
if (globalRecord['ErrorUtils'] === undefined) {
  globalRecord['ErrorUtils'] = {
    getGlobalHandler: () => () => {},
    setGlobalHandler: () => {},
  };
}

const spy = <T extends (...args: any[]) => any>(implementation?: T): T =>
  vi.fn(implementation) as unknown as T;
const makeNativeComponent =
  (name: string) => (props: Record<string, unknown> & { children?: unknown }) => ({
    $$type: name,
    props,
    children: props.children,
  });

mock.module('@react-native-async-storage/async-storage', () => {
  const impl = createAsyncStorageMock(spy);
  globalRecord['AsyncStorage'] = impl;
  return { __esModule: true, default: impl, ...impl };
});

mock.module('expo-secure-store', () => createSecureStoreMock(spy));
mock.module('expo-modules-core', () => createExpoModulesCoreMock(spy));
mock.module('expo-modules-core/src/polyfill/dangerous-internal', () => ({
  __esModule: true,
  ...expoModulesCorePolyfillMock,
  default:
    'default' in expoModulesCorePolyfillMock && expoModulesCorePolyfillMock.default
      ? expoModulesCorePolyfillMock.default
      : expoModulesCorePolyfillMock,
}));

// -----------------------------
// React Native core shim
// -----------------------------
mock.module('react-native', () => createReactNativeMock(spy, makeNativeComponent));
mock.module('react-native-sse', () => ({ __esModule: true, default: createSseMock(spy) }));
mock.module('expo-sqlite', () => createExpoSqliteMock(spy));
mock.module('expo-constants', () => createExpoConstantsMock('expo'));

mock.module('@taskforceai/api-client/client', () => {
  const makeApiClient = () => ({
    register: vi.fn(),
    runTask: vi.fn(),
    getTaskStatus: vi.fn(),
    getTaskResult: vi.fn(),
    runTaskStream: vi.fn(),
    getConversations: vi.fn(),
    getModelOptions: vi.fn(),
  });
  class ApiClientError extends Error {
    status?: number;
    body?: unknown;
    constructor(status?: number, body?: unknown, message?: string) {
      super(message ?? String(status ?? ''));
      if (typeof status === 'number') {
        this.status = status;
      }
      this.body = body;
    }
  }
  const ApiClientResponseError = ApiClientError;
  return {
    __esModule: true,
    createApiClient: () => {
      const client = makeApiClient();
      type TestClient = typeof client & {
        runTask: (prompt: string) => unknown;
        __throwRateLimit: () => void;
      };
      const testClient = client as TestClient;
      testClient.runTask = vi.fn((prompt: string) => {
        if (prompt.includes('Rate limit me')) {
          const err = new ApiClientError(
            429,
            {
              error:
                'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
              resetTime: '2025-01-01T00:00:00Z',
            },
            'Limited'
          );
          throw err;
        }
        return 'task-id';
      });
      // Helper to simulate rate limit errors in tests
      testClient.__throwRateLimit = () => {
        const err = new ApiClientError(
          429,
          {
            error:
              'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
            resetTime: '2025-01-01T00:00:00Z',
          },
          'Limited'
        );
        throw err;
      };
      return testClient;
    },
    ApiClientError,
    ApiClientResponseError,
  };
});

mock.module('@client-core/auth', () => {
  const makeAuthClient = (apiClient: unknown) => ({
    login: vi.fn(async () => ({
      ok: true,
      value: {
        accessToken: 'mock-token',
        expiresAt: Date.now() + 3600,
        user: { id: 'mock', email: 'mock@example.com', plan: 'free' },
      },
    })),
    logout: vi.fn(async () => ({ ok: true, value: undefined })),
    register: vi.fn(async () => ({
      ok: true,
      value: { email: 'mock@example.com', plan: 'free' },
    })),
    getCurrentUser: vi.fn(async () => ({
      ok: true,
      value: { email: 'mock@example.com', plan: 'free' },
    })),
    getSession: vi.fn(async () => ({
      ok: true,
      value: {
        accessToken: 'mock-token',
        expiresAt: Date.now() + 3600,
        user: { id: 'mock', email: 'mock@example.com', plan: 'free' },
      },
    })),
    getToken: vi.fn(async () => ({ ok: true, value: 'mock-token' })),
    getClient: vi.fn(() => apiClient),
  });
  return { __esModule: true, createAuthClient: makeAuthClient };
});

const patchScreenBindings = () => {
  if (domDocument) sharedPatchScreenBindings(domDocument);
};
patchScreenBindings();

setupMatchers();

mockRadixDismissableLayer();

// TanStack Router mock for apps that migrated from the legacy router
mock.module('@tanstack/react-router', () => {
  const React = require('react');

  // Mock Link component
  const Link = React.forwardRef(function MockLink(
    props: Record<string, unknown>,
    ref: React.Ref<HTMLAnchorElement>
  ) {
    const { to, children, ...rest } = props ?? {};
    const href = typeof to === 'string' ? to : to instanceof URL ? to.toString() : '/';
    return React.createElement('a', { ...rest, href, ref }, children);
  });

  // Mock router hooks - defined as spies so they can be tracked/mocked
  const mockNavigate = vi.fn();
  const mockUseRouter = vi.fn(() => ({
    navigate: mockNavigate,
    push: mockNavigate,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }));

  const mockUseLocation = vi.fn(() => ({
    pathname: '/',
    search: '',
    hash: '',
  }));

  const mockUseSearch = vi.fn(() => ({}));
  const mockUseParams = vi.fn(() => ({}));
  const mockUseNavigate = vi.fn(() => mockNavigate);

  return {
    __esModule: true,
    Link,
    useRouter: mockUseRouter,
    useLocation: mockUseLocation,
    useSearch: mockUseSearch,
    useParams: mockUseParams,
    useNavigate: mockUseNavigate,
    createFileRoute: () => (handler: unknown) => handler,
    createRootRoute: (routeConfig: unknown) => ({
      ...(routeConfig as any),
      _addFileChildren: () => ({ _addFileTypes: () => ({}) }),
    }),
    Outlet: () => null,
    RouterProvider: () => null,
    createRouter: () => ({
      history: { push: vi.fn(), replace: vi.fn() },
      subscribe: vi.fn(),
      load: vi.fn(),
    }),
    createMemoryHistory: vi.fn(),
  };
});

// --- Former tests/setup.ts content inlined for Bun ---

assignEnv({
  AUTH_SECRET: 'SpGZuG4IGiH/iiQopPsKRyIP6bDElSf/RMcLR+2fxJE=',
  AUTH_URL: 'http://localhost:3000',
  TASKFORCEAI_API_IN_MEMORY: 'true',
  NODE_ENV: 'test',
});

config({ path: resolve(process.cwd(), '.env.test') });

if (process.env['USE_REAL_DB'] === 'true' && process.env['TEST_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
}

const CHAOS_FETCH_FAILURE_RATE = (() => {
  const raw = process.env['CHAOS_FETCH_FAILURE_RATE'];
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
})();

const CHAOS_FETCH_MAX_LATENCY_MS = (() => {
  const raw = process.env['CHAOS_FETCH_MAX_LATENCY_MS'];
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
})();

// Set test database URL BEFORE any imports that might initialize Prisma
const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ||
  process.env['DATABASE_URL'] ||
  'postgresql://postgres:postgres@localhost:5432/taskforceai_test?schema=public&sslmode=disable';
assignEnv({ DATABASE_URL: TEST_DATABASE_URL });

mockWindowLocation();
mockAnchorClicks();

sharedPatchFetch({
  chaosFailureRate: CHAOS_FETCH_FAILURE_RATE,
  chaosMaxLatencyMs: CHAOS_FETCH_MAX_LATENCY_MS,
});

// Start each test with a clean React tree
beforeEach(() => {
  ensureDomBindings();
  if (!domWindow || !documentProxy) {
    return;
  }
  setGlobal('window', domWindow);
  setGlobal('document', documentProxy);
  setGlobal('navigator', domWindow.navigator);
  setGlobal('localStorage', domWindow.localStorage);
  setGlobal('sessionStorage', domWindow.sessionStorage);
  const locDescriptor = Object.getOwnPropertyDescriptor(domWindow, 'location');
  if (!locDescriptor?.configurable) {
    try {
      domWindow.location.href = 'http://localhost/';
      // Basic location shim
      Object.defineProperty(domWindow, 'location', {
        value: {
          href: 'http://localhost/',
          assign: () => {},
          replace: () => {},
          reload: () => {},
        },
        configurable: true,
        writable: true,
      });
    } catch {
      /* noop */
    }
  }
  patchScreenBindings();
  cleanup();
});

// Ensure DOM globals stay available even when individual tests mutate them
afterEach(() => {
  ensureDomBindings();
  if (!domWindow || !documentProxy) {
    return;
  }
  setGlobal('window', domWindow);
  setGlobal('document', documentProxy);
  setGlobal('navigator', domWindow.navigator);
  setGlobal('localStorage', domWindow.localStorage);
  setGlobal('sessionStorage', domWindow.sessionStorage);
  patchScreenBindings();
  cleanup();
});
