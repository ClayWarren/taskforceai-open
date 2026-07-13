import { describe, expect, it, vi } from 'bun:test';

import { initializeI18n, type I18nLike } from './config';

describe('i18n/config', () => {
  it('does nothing when the i18n instance is already initialized', () => {
    const i18nInstance = {
      isInitialized: true,
      use: vi.fn(),
      init: vi.fn(),
    } as I18nLike;

    initializeI18n(i18nInstance, { resources: {} });

    expect(i18nInstance.use).not.toHaveBeenCalled();
    expect(i18nInstance.init).not.toHaveBeenCalled();
  });

  it('initializes i18n with provided plugins, stable defaults, and option overrides', () => {
    const init = vi.fn();
    const plugin = { type: '3rdParty' };
    const i18nInstance = {
      isInitialized: false,
      use: vi.fn().mockReturnThis(),
      init,
    } as I18nLike;

    initializeI18n(i18nInstance, {
      resources: { en: { translation: { hello: 'Hello' } } },
      lng: 'fr',
      fallbackLng: 'en',
      debug: true,
      plugins: [plugin],
      interpolation: { escapeValue: true },
      detection: { order: ['navigator'], caches: [] },
    });

    expect(i18nInstance.use).toHaveBeenCalledWith(plugin);
    expect(init).toHaveBeenCalledWith({
      resources: { en: { translation: { hello: 'Hello' } } },
      lng: 'fr',
      fallbackLng: 'en',
      debug: true,
      interpolation: {
        escapeValue: true,
      },
      detection: {
        order: ['navigator'],
        caches: [],
      },
      react: {
        useSuspense: false,
      },
    });
  });

  it('uses English, host-neutral detection, and non-escaping interpolation by default', () => {
    const init = vi.fn();
    const i18nInstance = {
      isInitialized: false,
      use: vi.fn().mockReturnThis(),
      init,
    } as I18nLike;

    initializeI18n(i18nInstance, { resources: {} });

    expect(i18nInstance.use).not.toHaveBeenCalled();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        lng: 'en',
        fallbackLng: 'en',
        debug: false,
        interpolation: {
          escapeValue: false,
        },
        detection: {
          order: [],
          caches: [],
        },
      })
    );
  });
});
