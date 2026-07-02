import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  applyThemePreference,
  clearThemePreference,
  readStoredThemePreference,
  readSystemThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from './theme-preference';

vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('theme-preference', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let mockStorage: Map<string, string>;
  const createMediaQueryList = (matches: boolean): MediaQueryList => ({
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  });

  let mockSetAttribute: ReturnType<typeof vi.fn>;
  let mockClassListToggle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStorage = new Map();
    mockSetAttribute = vi.fn();
    mockClassListToggle = vi.fn(() => false);
    const storage: Storage = {
      get length() {
        return mockStorage.size;
      },
      clear: () => {
        mockStorage.clear();
      },
      key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      removeItem: (key: string) => {
        mockStorage.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: storage,
        matchMedia: vi.fn((query: string) => createMediaQueryList(query.includes('dark'))),
      },
      configurable: true,
      writable: true,
    });
    // Create mock document with mockable methods
    Object.defineProperty(globalThis, 'document', {
      value: {
        documentElement: {
          setAttribute: mockSetAttribute,
        },
        body: {
          classList: {
            toggle: mockClassListToggle,
            add: vi.fn(),
            remove: vi.fn(),
          },
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  describe('readStoredThemePreference', () => {
    it('returns light theme when stored', () => {
      mockStorage.set('theme', 'light');
      const result = readStoredThemePreference();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('light');
    });

    it('returns dark theme when stored', () => {
      mockStorage.set('theme', 'dark');
      const result = readStoredThemePreference();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('dark');
    });

    it('returns invalid error when no theme stored', () => {
      const result = readStoredThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('invalid');
    });

    it('returns invalid error for invalid theme value', () => {
      mockStorage.set('theme', 'purple');
      const result = readStoredThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('invalid');
    });

    it('returns unavailable error when window is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = readStoredThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns failed error when localStorage throws', () => {
      const storage: Storage = {
        length: 0,
        clear: () => {},
        key: () => null,
        getItem: () => {
          throw new Error('Storage error');
        },
        setItem: () => {},
        removeItem: () => {},
      };
      Object.defineProperty(globalThis, 'window', {
        value: {
          localStorage: storage,
        },
        configurable: true,
        writable: true,
      });
      const result = readStoredThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('failed');
    });
  });

  describe('readSystemThemePreference', () => {
    it('returns dark when system prefers dark', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => createMediaQueryList(true)),
          configurable: true,
        });
      }
      expect(readSystemThemePreference()).toBe('dark');
    });

    it('returns light when system prefers light', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => createMediaQueryList(false)),
          configurable: true,
        });
      }
      expect(readSystemThemePreference()).toBe('light');
    });

    it('returns dark when window is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(readSystemThemePreference()).toBe('dark');
    });

    it('returns light when matchMedia is undefined', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
      expect(readSystemThemePreference()).toBe('light');
    });
  });

  describe('applyThemePreference', () => {
    it('applies dark theme successfully', () => {
      const result = applyThemePreference('dark');
      expect(result.ok).toBe(true);
      expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'dark');
      expect(mockClassListToggle).toHaveBeenCalledWith('dark-theme', true);
      expect(mockClassListToggle).toHaveBeenCalledWith('light-theme', false);
      expect(mockStorage.get('theme')).toBe('dark');
    });

    it('applies light theme successfully', () => {
      const result = applyThemePreference('light');
      expect(result.ok).toBe(true);
      expect(mockStorage.get('theme')).toBe('light');
    });

    it('returns unavailable when document is undefined', () => {
      Object.defineProperty(globalThis, 'document', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = applyThemePreference('dark');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns unavailable when window is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = applyThemePreference('dark');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns failed error when setting throws', () => {
      mockSetAttribute.mockImplementation(() => {
        throw new Error('DOM error');
      });
      const result = applyThemePreference('dark');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('failed');
    });
  });

  describe('resolveInitialThemePreference', () => {
    it('returns stored theme when available', () => {
      mockStorage.set('theme', 'light');
      expect(resolveInitialThemePreference()).toBe('light');
    });

    it('falls back to system theme when no stored theme', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => createMediaQueryList(true)),
          configurable: true,
        });
      }
      expect(resolveInitialThemePreference()).toBe('system');
    });
  });

  describe('subscribeToSystemTheme', () => {
    it('subscribes to theme changes and returns unsubscribe function', () => {
      const onChange = vi.fn();
      const mockAddEventListener = vi.fn();
      const mockRemoveEventListener = vi.fn();
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => {
            const mediaQuery = createMediaQueryList(false);
            mediaQuery.addEventListener = mockAddEventListener;
            mediaQuery.removeEventListener = mockRemoveEventListener;
            return mediaQuery;
          }),
          configurable: true,
        });
      }

      const result = subscribeToSystemTheme(onChange);
      expect(result.ok).toBe(true);
      expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      if (result.ok) {
        result.value(); // unsubscribe
        expect(mockRemoveEventListener).toHaveBeenCalled();
      }
    });

    it('calls onChange with dark when matches is true', () => {
      const onChange = vi.fn();
      let capturedHandler: ((event: Event) => void) | null = null;
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => {
            const mediaQuery = createMediaQueryList(true);
            mediaQuery.addEventListener = (
              _: string,
              handler: EventListenerOrEventListenerObject
            ) => {
              if (typeof handler === 'function') {
                capturedHandler = handler;
              }
            };
            return mediaQuery;
          }),
          configurable: true,
        });
      }

      subscribeToSystemTheme(onChange);
      if (capturedHandler) {
        const event = Object.assign(new Event('change'), { matches: true, media: '' });
        (capturedHandler as (event: Event) => void)(event);
      }
      expect(onChange).toHaveBeenCalledWith('dark');
    });

    it('calls onChange with light when matches is false', () => {
      const onChange = vi.fn();
      let capturedHandler: ((event: Event) => void) | null = null;
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => {
            const mediaQuery = createMediaQueryList(false);
            mediaQuery.addEventListener = (
              _: string,
              handler: EventListenerOrEventListenerObject
            ) => {
              if (typeof handler === 'function') {
                capturedHandler = handler;
              }
            };
            return mediaQuery;
          }),
          configurable: true,
        });
      }

      subscribeToSystemTheme(onChange);
      if (capturedHandler) {
        const event = Object.assign(new Event('change'), { matches: false, media: '' });
        (capturedHandler as (event: Event) => void)(event);
      }
      expect(onChange).toHaveBeenCalledWith('light');
    });

    it('returns unavailable when window is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = subscribeToSystemTheme(vi.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns unavailable when matchMedia is undefined', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: undefined,
          configurable: true,
          writable: true,
        });
      }
      const result = subscribeToSystemTheme(vi.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns unavailable when addEventListener is not available', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => ({})),
          configurable: true,
        });
      }
      const result = subscribeToSystemTheme(vi.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns failed error when addEventListener throws', () => {
      const windowRef = globalThis.window;
      if (windowRef) {
        Object.defineProperty(windowRef, 'matchMedia', {
          value: vi.fn(() => ({
            addEventListener: () => {
              throw new Error('Event error');
            },
            removeEventListener: vi.fn(),
          })),
          configurable: true,
        });
      }
      const result = subscribeToSystemTheme(vi.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('failed');
    });
  });

  describe('clearThemePreference', () => {
    it('clears stored theme successfully', () => {
      mockStorage.set('theme', 'dark');
      const result = clearThemePreference();
      expect(result.ok).toBe(true);
      expect(mockStorage.has('theme')).toBe(false);
    });

    it('returns unavailable when window is undefined', () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const result = clearThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('unavailable');
    });

    it('returns failed error when removeItem throws', () => {
      const storage: Storage = {
        length: 0,
        clear: () => {},
        key: () => null,
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error('Storage error');
        },
      };
      Object.defineProperty(globalThis, 'window', {
        value: { localStorage: storage },
        configurable: true,
        writable: true,
      });
      const result = clearThemePreference();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('failed');
    });
  });
});
