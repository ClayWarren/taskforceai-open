import en from '@taskforceai/locales/en.json';
import es from '@taskforceai/locales/es.json';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { initializeI18n, type I18nLike } from '@taskforceai/presenters/i18n/config';

const resources = {
  en: { translation: en },
  es: { translation: es },
};

initializeI18n(i18n as I18nLike, { resources, debug: false, plugins: [initReactI18next] });

export default i18n;
