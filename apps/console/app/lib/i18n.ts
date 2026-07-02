import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation files
import en from '@taskforceai/locales/en.json';
import es from '@taskforceai/locales/es.json';
import { readStorageItem } from './platform/browser-storage';

const resources = {
  en: {
    translation: en,
  },
  es: {
    translation: es,
  },
};

// Initialize i18n only if not already initialized
if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next) // passes i18n down to react-i18next
    .init({
      resources,
      lng: 'en', // Default language, will be overridden on client-side
      fallbackLng: 'en',
      debug: false,

      interpolation: {
        escapeValue: false, // react already does escaping
      },

      // Detection will be handled on client-side
      detection: {
        order: ['localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    });
}

// Client-side initialization
export const initializeI18n = () => {
  const savedLanguage = readStorageItem('i18nextLng');
  if (savedLanguage.ok) {
    if (i18n.isInitialized) {
      void i18n.changeLanguage(savedLanguage.value);
    } else {
      i18n.on('initialized', () => {
        void i18n.changeLanguage(savedLanguage.value);
      });
    }
  }
};

export default i18n;
