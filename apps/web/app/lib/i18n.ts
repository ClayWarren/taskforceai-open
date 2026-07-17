import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { initializeI18n as baseInit, type I18nLike } from '@taskforceai/presenters/i18n/config';

// Import translation files
import en from '@taskforceai/locales/en.json';
import es from '@taskforceai/locales/es.json';
import { readStorageItem } from '@taskforceai/browser-runtime/browser-storage';

const resources = {
  en: {
    translation: en,
  },
  es: {
    translation: es,
  },
};

baseInit(i18n as I18nLike, {
  resources,
  debug: false,
  plugins: [initReactI18next],
  detection: {
    order: ['localStorage', 'navigator'],
    caches: ['localStorage'],
  },
});

// Client-side initialization
export const initializeI18n = () => {
  const savedLanguage = readStorageItem('i18nextLng');
  if (savedLanguage.ok && i18n.isInitialized) {
    void i18n.changeLanguage(savedLanguage.value);
  }
};

export default i18n;
