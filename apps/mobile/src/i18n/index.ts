import en from '@taskforceai/locales/en.json';
import es from '@taskforceai/locales/es.json';
import i18n from 'i18next';
import { initializeI18n } from '@taskforceai/shared/i18n/config';

const resources = {
  en: { translation: en },
  es: { translation: es },
};

initializeI18n(i18n as any, { resources, debug: false });

export default i18n;
