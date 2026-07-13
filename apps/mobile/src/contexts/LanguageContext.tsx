import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n from '../i18n';
import { createModuleLogger } from '../logger';

const LANGUAGE_STORAGE_KEY = '@taskforceai:language';
const logger = createModuleLogger('LanguageContext');

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const loadLanguage = async () => {
      try {
        const storedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (storedLanguage) {
          await i18n.changeLanguage(storedLanguage);
        }
      } catch (error) {
        logger.warn('Failed to load saved language preference', { error });
      }
    };

    void loadLanguage();
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
