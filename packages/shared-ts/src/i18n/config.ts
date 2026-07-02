import type { i18n, Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

export interface I18nConfigOptions {
  resources: Resource;
  lng?: string;
  fallbackLng?: string;
  debug?: boolean;
  locizeLastUsed?: boolean;
  interpolation?: {
    escapeValue?: boolean;
  };
  detection?: {
    order?: string[];
    caches?: string[];
  };
}

export const initializeI18n = (i18nInstance: i18n, options: I18nConfigOptions) => {
  if (i18nInstance.isInitialized) return;

  void i18nInstance.use(initReactI18next).init({
    resources: options.resources,
    lng: options.lng || 'en',
    fallbackLng: options.fallbackLng || 'en',
    debug: options.debug || false,
    interpolation: {
      escapeValue: options.interpolation?.escapeValue ?? false,
    },
    detection: options.detection || {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
  });
};
