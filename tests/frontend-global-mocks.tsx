import { mock } from 'bun:test';
import path from 'path';

// Force use of same React instance across all modules to prevent hook dispatcher issues
// We mock the modules at the top level so all subsequent imports get the same instance.
// We use absolute paths to ensure we're getting the root node_modules version.
const repoRoot = path.resolve(import.meta.dir, '..');
const reactPath = path.resolve(repoRoot, 'node_modules/react/index.js');
const reactDomPath = path.resolve(repoRoot, 'node_modules/react-dom/index.js');
const reactDomClientPath = path.resolve(repoRoot, 'node_modules/react-dom/client.js');

const ReactInstance = require(reactPath);
const ReactDOMInstance = require(reactDomPath);
const ReactDOMClientInstance = require(reactDomClientPath);
const jsxRuntimePath = path.resolve(repoRoot, 'node_modules/react/jsx-runtime.js');
const jsxRuntimeInstance = require(jsxRuntimePath);

// Bridge dispatcher between all possible React instances
const sharedInternals = ReactInstance.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
if (sharedInternals) {
  // Store the dispatcher globally so we can restore it if it's lost
  (globalThis as any).__REACT_DISPATCHER = sharedInternals.H;

  // For React 19, H is the hooks dispatcher, A is the async dispatcher
  const targetInternals = [
    ReactDOMInstance?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
    ReactDOMClientInstance?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
    jsxRuntimeInstance?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  ];

  targetInternals.forEach((target) => {
    if (target && target !== sharedInternals) {
      Object.defineProperties(target, {
        H: {
          get: () => sharedInternals.H || (globalThis as any).__REACT_DISPATCHER,
          set: (v) => {
            sharedInternals.H = v;
            if (v) (globalThis as any).__REACT_DISPATCHER = v;
          },
          configurable: true,
        },
        A: {
          get: () => sharedInternals.A,
          set: (v) => {
            sharedInternals.A = v;
          },
          configurable: true,
        },
      });
    }
  });
}

mock.module('react', () => {
  const hooks = [
    'useState',
    'useReducer',
    'useEffect',
    'useLayoutEffect',
    'useCallback',
    'useMemo',
    'useRef',
    'useContext',
    'useId',
    'useImperativeHandle',
    'useInsertionEffect',
    'useTransition',
    'useDeferredValue',
    'useSyncExternalStore',
  ];

  const wrappedReact = { ...ReactInstance, __esModule: true, default: ReactInstance };

  hooks.forEach((hook) => {
    if (typeof ReactInstance[hook] === 'function') {
      wrappedReact[hook] = (...args: any[]) => {
        if (
          !ReactInstance.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.H &&
          (globalThis as any).__REACT_DISPATCHER
        ) {
          ReactInstance.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.H = (
            globalThis as any
          ).__REACT_DISPATCHER;
        }
        return ReactInstance[hook](...args);
      };
    }
  });

  return wrappedReact;
});
mock.module(reactPath, () => ({ ...ReactInstance, __esModule: true, default: ReactInstance }));
mock.module('react-dom', () => ({
  ...ReactDOMInstance,
  __esModule: true,
  default: ReactDOMInstance,
}));
mock.module(reactDomPath, () => ({
  ...ReactDOMInstance,
  __esModule: true,
  default: ReactDOMInstance,
}));
mock.module('react-dom/client', () => ({
  ...ReactDOMClientInstance,
  __esModule: true,
  default: ReactDOMClientInstance,
}));
mock.module(reactDomClientPath, () => ({
  ...ReactDOMClientInstance,
  __esModule: true,
  default: ReactDOMClientInstance,
}));
mock.module('react/jsx-runtime', () => ({
  ...jsxRuntimeInstance,
  __esModule: true,
  default: jsxRuntimeInstance,
}));
mock.module(jsxRuntimePath, () => ({
  ...jsxRuntimeInstance,
  __esModule: true,
  default: jsxRuntimeInstance,
}));

import React from 'react';

const register = (targets: string[], factory: () => any) => {
  targets.forEach((id) => void mock.module(id, factory));
};

type FrontendVoiceStatus = 'idle' | 'initializing' | 'ready' | 'error';
type FrontendVoiceAdapter = {
  init: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  listen: () => Promise<string>;
  record: () => Promise<{ data: string; format: string }>;
  finishListening?: () => Promise<void>;
  cancel: () => Promise<void>;
};

const createDefaultVoiceAdapter = (): FrontendVoiceAdapter => ({
  init: async () => undefined,
  speak: async () => undefined,
  listen: async () => '',
  record: async () => ({ data: '', format: 'wav' }),
  cancel: async () => undefined,
});

let frontendVoiceAdapter = createDefaultVoiceAdapter();
let frontendVoiceStatus: FrontendVoiceStatus = 'idle';
let frontendVoiceError: Error | null = null;
const frontendVoiceListeners = new Set<() => void>();

const notifyFrontendVoiceListeners = () => {
  for (const listener of frontendVoiceListeners) {
    listener();
  }
};

const frontendVoiceManager = {
  setAdapter: (adapter: FrontendVoiceAdapter) => {
    frontendVoiceAdapter = adapter;
    frontendVoiceStatus = 'idle';
    frontendVoiceError = null;
    notifyFrontendVoiceListeners();
  },
  subscribe: (listener: () => void) => {
    frontendVoiceListeners.add(listener);
    return () => frontendVoiceListeners.delete(listener);
  },
  getStatus: () => frontendVoiceStatus,
  getError: () => frontendVoiceError,
  init: async () => {
    frontendVoiceStatus = 'initializing';
    frontendVoiceError = null;
    notifyFrontendVoiceListeners();
    try {
      await frontendVoiceAdapter.init();
      frontendVoiceStatus = 'ready';
      notifyFrontendVoiceListeners();
    } catch (error) {
      frontendVoiceError = error instanceof Error ? error : new Error(String(error));
      frontendVoiceStatus = 'error';
      notifyFrontendVoiceListeners();
      throw frontendVoiceError;
    }
  },
  speak: (text: string) => frontendVoiceAdapter.speak(text),
  listen: () => frontendVoiceAdapter.listen(),
  record: () => frontendVoiceAdapter.record(),
  finishListening: () => frontendVoiceAdapter.finishListening?.() ?? frontendVoiceAdapter.cancel(),
  cancel: () => frontendVoiceAdapter.cancel(),
};

register(['react-i18next'], () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="i18n">{children}</div>
  ),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

register(['@taskforceai/voice', path.resolve(repoRoot, 'tests/mocks/voice.ts')], () => ({
  isVoiceCancellationError: () => false,
  voiceManager: frontendVoiceManager,
}));

register(['@taskforceai/react-core/useVoice'], () => ({
  useVoice: () => ({
    manager: frontendVoiceManager,
    status: ReactInstance.useSyncExternalStore(
      frontendVoiceManager.subscribe,
      frontendVoiceManager.getStatus,
      frontendVoiceManager.getStatus
    ),
    error: ReactInstance.useSyncExternalStore(
      frontendVoiceManager.subscribe,
      frontendVoiceManager.getError,
      frontendVoiceManager.getError
    ),
  }),
}));

register(['@taskforceai/api-client/browserClient'], () => ({
  getBrowserClient: () => ({
    currentUser: async () => ({
      username: 'mock',
      email: 'mock@example.com',
      full_name: 'Mock User',
      plan: 'free',
      message_count: 0,
      last_message_timestamp: null,
      subscription_id: null,
      subscription_status: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      theme_preference: 'dark',
      customer_id: null,
      disabled: 'false',
      is_admin: 'false',
    }),
    getStorageSummary: async () => ({
      usedBytes: 0,
      quotaBytes: 0,
      categories: [],
    }),
    logout: async () => {},
  }),
  setBrowserClient: () => {},
  clearBrowserClientCache: () => {},
}));
