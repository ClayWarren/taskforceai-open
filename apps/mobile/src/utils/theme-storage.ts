import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  readStoredThemeModeValue,
  storeThemeModeValue,
} from '@taskforceai/persistence/preferences/theme-storage';

import { createModuleLogger } from '../logger';
import type { ThemeMode } from '../theme/theme';

const THEME_KEY = '@taskforceai:theme_mode';
const logger = createModuleLogger('ThemeStorage');

export const storeThemeMode = async (mode: ThemeMode): Promise<void> => {
  await storeThemeModeValue(
    {
      write: (value) => AsyncStorage.setItem(THEME_KEY, value),
    },
    mode,
    {
      onWriteError: (error, value) => logger.error('Failed to store theme mode', { error, mode: value }),
    }
  );
};

export const loadThemeMode = async (): Promise<ThemeMode | null> => {
  return readStoredThemeModeValue<ThemeMode>(
    {
      read: () => AsyncStorage.getItem(THEME_KEY),
    },
    {
      allowedModes: ['dark', 'light'],
      onReadError: (error) => logger.error('Failed to load theme mode', { error }),
    }
  );
};
