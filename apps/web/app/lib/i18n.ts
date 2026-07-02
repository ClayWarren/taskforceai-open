import i18n from 'i18next';
import { initializeI18n as baseInit } from '@taskforceai/shared/i18n/config';

// Import translation files
import en from '@taskforceai/locales/en.json';
import es from '@taskforceai/locales/es.json';
import { readStorageItem } from '@taskforceai/shared/utils/browser-storage';

const resources = {
  en: {
    translation: en,
  },
  es: {
    translation: es,
  },
};

baseInit(i18n, { resources, debug: false });

// Client-side initialization
export const initializeI18n = () => {
  const savedLanguage = readStorageItem('i18nextLng');
  if (savedLanguage.ok && i18n.isInitialized) {
    void i18n.changeLanguage(savedLanguage.value);
  }
};

export default i18n;
