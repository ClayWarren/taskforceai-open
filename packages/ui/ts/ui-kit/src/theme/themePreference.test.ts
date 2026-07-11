import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@taskforceai/api-client/auth/logger', () => ({
  getAuthLogger: () => ({
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  applyThemePreference,
  clearThemePreference,
  readStoredThemePreference,
  readSystemThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from './themePreference';

describe('themePreference', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let mockStorage: Map<string, string>;
  let mockSetAttribute: ReturnType<typeof vi.fn>;
  let mockDocumentElementClassToggle: ReturnType<typeof vi.fn>;
  let mockBodyClassToggle: ReturnType<typeof vi.fn>;

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

  const createStorage = (): Storage => ({
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
  });

  beforeEach(() => {
    mockStorage = new Map();
    mockSetAttribute = vi.fn();
    mockDocumentElementClassToggle = vi.fn(() => false);
    mockBodyClassToggle = vi.fn(() => false);

    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: createStorage(),
        matchMedia: vi.fn((query: string) => createMediaQueryList(query.includes('dark'))),
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'document', {
      value: {
        documentElement: {
          setAttribute: mockSetAttribute,
          classList: {
            toggle: mockDocumentElementClassToggle,
          },
        },
        body: {
          classList: {
            toggle: mockBodyClassToggle,
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

  it('reads valid stored preferences and rejects missing or invalid values', () => {
    mockStorage.set('theme', 'light');
    expect(readStoredThemePreference()).toEqual({ ok: true, value: 'light' });

    mockStorage.set('theme', 'purple');
    const invalid = readStoredThemePreference();
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.kind).toBe('invalid');

    mockStorage.delete('theme');
    const missing = readStoredThemePreference();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe('invalid');
  });

  it('reports unavailable or failed storage reads', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const unavailable = readStoredThemePreference();
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.kind).toBe('unavailable');

    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          getItem: () => {
            throw new Error('Storage error');
          },
        },
      },
      configurable: true,
      writable: true,
    });
    const failed = readStoredThemePreference();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.kind).toBe('failed');
  });

  it('resolves system theme preferences', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { matchMedia: vi.fn(() => createMediaQueryList(true)) },
      configurable: true,
      writable: true,
    });
    expect(readSystemThemePreference()).toBe('dark');

    Object.defineProperty(globalThis, 'window', {
      value: { matchMedia: vi.fn(() => createMediaQueryList(false)) },
      configurable: true,
      writable: true,
    });
    expect(readSystemThemePreference()).toBe('light');

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(readSystemThemePreference()).toBe('dark');
  });

  it('applies and persists the resolved theme immediately when animation frames are unavailable', () => {
    const result = applyThemePreference('dark', { setDarkClass: true });

    expect(result).toEqual({ ok: true, value: true });
    expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(mockDocumentElementClassToggle).toHaveBeenCalledWith('dark', true);
    expect(mockBodyClassToggle).toHaveBeenCalledWith('dark-theme', true);
    expect(mockBodyClassToggle).toHaveBeenCalledWith('light-theme', false);
    expect(mockStorage.get('theme')).toBe('dark');
  });

  it('reports unavailable theme application without browser globals', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = applyThemePreference('dark');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unavailable');
    expect(mockSetAttribute).not.toHaveBeenCalled();
  });

  it('applies theme changes synchronously when animation frames are available', () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.fn();
    Object.assign(globalThis.window, { requestAnimationFrame, cancelAnimationFrame });

    expect(applyThemePreference('light').ok).toBe(true);
    expect(applyThemePreference('dark').ok).toBe(true);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('returns failed when DOM application throws', () => {
    mockSetAttribute.mockImplementation(() => {
      throw new Error('DOM error');
    });

    const result = applyThemePreference('dark');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('failed');
  });

  it('returns failed when theme persistence throws after DOM application', () => {
    Object.defineProperty(globalThis.window, 'localStorage', {
      value: {
        setItem: () => {
          throw new Error('Storage write failed');
        },
      },
      configurable: true,
    });

    const result = applyThemePreference('light');

    expect(mockSetAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('failed');
  });

  it('resolves the initial preference from storage or falls back to system', () => {
    mockStorage.set('theme', 'light');
    expect(resolveInitialThemePreference()).toBe('light');

    mockStorage.delete('theme');
    expect(resolveInitialThemePreference()).toBe('system');
  });

  it('subscribes to system theme changes and removes the listener', () => {
    const onChange = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(globalThis.window, 'matchMedia', {
      value: vi.fn(() =>
        Object.assign(createMediaQueryList(false), {
          addEventListener,
          removeEventListener,
        })
      ),
      configurable: true,
    });

    const result = subscribeToSystemTheme(onChange);

    expect(result.ok).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    if (result.ok) result.value();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('reports unavailable subscriptions when media query events are unsupported', () => {
    Object.defineProperty(globalThis.window, 'matchMedia', {
      value: vi.fn(() =>
        Object.assign(createMediaQueryList(false), {
          addEventListener: undefined,
        })
      ),
      configurable: true,
    });

    const result = subscribeToSystemTheme(vi.fn());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unavailable');
  });

  it('logs a warning when removing the system theme listener fails', () => {
    const removeEventListener = vi.fn(() => {
      throw new Error('Remove failed');
    });
    Object.defineProperty(globalThis.window, 'matchMedia', {
      value: vi.fn(() =>
        Object.assign(createMediaQueryList(false), {
          removeEventListener,
        })
      ),
      configurable: true,
    });

    const result = subscribeToSystemTheme(vi.fn());

    expect(result.ok).toBe(true);
    if (result.ok) result.value();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('passes the resolved theme to system preference listeners', () => {
    const onChange = vi.fn();
    const captured: { handler?: (event: MediaQueryListEvent) => void } = {};
    Object.defineProperty(globalThis.window, 'matchMedia', {
      value: vi.fn(() =>
        Object.assign(createMediaQueryList(false), {
          addEventListener: (_event: string, handler: (event: MediaQueryListEvent) => void) => {
            captured.handler = handler;
          },
        })
      ),
      configurable: true,
    });

    subscribeToSystemTheme(onChange);
    expect(captured.handler).toBeDefined();
    const handler = captured.handler as (event: MediaQueryListEvent) => void;
    handler({ matches: true } as MediaQueryListEvent);
    handler({ matches: false } as MediaQueryListEvent);

    expect(onChange).toHaveBeenNthCalledWith(1, 'dark');
    expect(onChange).toHaveBeenNthCalledWith(2, 'light');
  });

  it('reports unavailable or failed system theme subscriptions', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const unavailable = subscribeToSystemTheme(vi.fn());
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.kind).toBe('unavailable');

    Object.defineProperty(globalThis, 'window', {
      value: {
        matchMedia: vi.fn(() => ({
          addEventListener: () => {
            throw new Error('Event error');
          },
        })),
      },
      configurable: true,
      writable: true,
    });
    const failed = subscribeToSystemTheme(vi.fn());
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.kind).toBe('failed');
  });

  it('clears stored theme preferences', () => {
    mockStorage.set('theme', 'dark');
    expect(clearThemePreference()).toEqual({ ok: true, value: true });
    expect(mockStorage.has('theme')).toBe(false);
  });

  it('reports unavailable and failed clear operations', () => {
    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const unavailable = clearThemePreference();
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.kind).toBe('unavailable');

    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: {
          removeItem: () => {
            throw new Error('Storage remove failed');
          },
        },
      },
      configurable: true,
      writable: true,
    });
    const failed = clearThemePreference();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.kind).toBe('failed');
  });
});
