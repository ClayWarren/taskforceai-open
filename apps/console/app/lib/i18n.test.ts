import { describe, it, expect, vi, beforeEach } from 'bun:test';
import i18n, { initializeI18n } from './i18n';
import { readStorageItem } from '@taskforceai/browser-runtime/browser-storage';
import { ok, err } from '@taskforceai/client-core/result';

vi.mock('@taskforceai/browser-runtime/browser-storage', () => ({
  readStorageItem: vi.fn(),
}));

describe('i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default language', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBeDefined();
  });

  it('changes language when initializeI18n finds a saved preference', async () => {
    (readStorageItem as any).mockReturnValue(ok('es'));
    const spy = vi.spyOn(i18n, 'changeLanguage');

    initializeI18n();

    expect(readStorageItem).toHaveBeenCalledWith('i18nextLng');
    expect(spy).toHaveBeenCalledWith('es');
  });

  it('does not change language if no preference found', () => {
    (readStorageItem as any).mockReturnValue(err({ kind: 'missing' }));
    const spy = vi.spyOn(i18n, 'changeLanguage');

    initializeI18n();

    expect(spy).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('registers listener when i18n is not initialized', () => {
    (readStorageItem as any).mockReturnValue(ok('es'));
    const originalIsInitialized = i18n.isInitialized;
    Object.defineProperty(i18n, 'isInitialized', {
      value: false,
      configurable: true,
      writable: true,
    });

    const onSpy = vi.spyOn(i18n, 'on');
    const changeLanguageSpy = vi.spyOn(i18n, 'changeLanguage');

    initializeI18n();

    expect(onSpy).toHaveBeenCalledWith('initialized', expect.any(Function));
    expect(changeLanguageSpy).not.toHaveBeenCalled();

    // Call the registered listener callback
    const calls = onSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const callback = calls[0]?.[1] as any;
    if (callback) {
      callback();
    }
    expect(changeLanguageSpy).toHaveBeenCalledWith('es');

    Object.defineProperty(i18n, 'isInitialized', {
      value: originalIsInitialized,
      configurable: true,
      writable: true,
    });
    onSpy.mockRestore();
    changeLanguageSpy.mockRestore();
  });
});
