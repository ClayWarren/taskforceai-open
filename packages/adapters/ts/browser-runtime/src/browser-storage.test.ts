import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import { readStorageItem, removeStorageItem, writeStorageItem } from './browser-storage';

const globalScope = globalThis as Record<string, unknown>;

let previousWindow: unknown;

const restoreWindow = (): void => {
  if (previousWindow === undefined) {
    delete globalScope['window'];
    return;
  }
  globalScope['window'] = previousWindow;
};

describe('client-core/utils/browser-storage', () => {
  beforeEach(() => {
    previousWindow = globalScope['window'];
  });

  afterEach(() => {
    restoreWindow();
    vi.restoreAllMocks();
  });

  it('returns unavailable when localStorage is not available', () => {
    globalScope['window'] = {};

    const result = readStorageItem('missing');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Local storage unavailable.' },
    });
  });

  it('returns unavailable when localStorage getter throws', () => {
    const windowWithThrowingStorage: Record<string, unknown> = {};
    Object.defineProperty(windowWithThrowingStorage, 'localStorage', {
      get() {
        throw new Error('denied');
      },
      configurable: true,
    });
    globalScope['window'] = windowWithThrowingStorage;

    const result = readStorageItem('session');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Local storage unavailable.' },
    });
  });

  it('returns missing when key is absent', () => {
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    globalScope['window'] = { localStorage: localStorageMock };

    const result = readStorageItem('session');

    expect(localStorageMock.getItem).toHaveBeenCalledWith('session');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing', message: 'Storage key not found.' },
    });
  });

  it('returns failed when localStorage read throws', () => {
    const localStorageMock = {
      getItem: vi.fn(() => {
        throw new Error('storage read denied');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    globalScope['window'] = { localStorage: localStorageMock };

    const result = readStorageItem('session');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to read local storage.' },
    });
  });

  it('writes a storage value when localStorage is available', () => {
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    globalScope['window'] = { localStorage: localStorageMock };

    const result = writeStorageItem('session', 'abc123');

    expect(localStorageMock.setItem).toHaveBeenCalledWith('session', 'abc123');
    expect(result).toEqual({ ok: true, value: true });
  });

  it('returns unavailable from write when localStorage is unavailable', () => {
    globalScope['window'] = {};

    expect(writeStorageItem('session', 'abc123')).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: 'Local storage unavailable.' },
    });
  });

  it('returns failed when localStorage write throws', () => {
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('storage write denied');
      }),
      removeItem: vi.fn(),
    };
    globalScope['window'] = { localStorage: localStorageMock };

    const result = writeStorageItem('session', 'abc123');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to write local storage.' },
    });
  });

  it('returns failed when localStorage remove throws', () => {
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new Error('storage remove denied');
      }),
    };
    globalScope['window'] = { localStorage: localStorageMock };

    const result = removeStorageItem('session');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Failed to remove local storage.' },
    });
  });
});
