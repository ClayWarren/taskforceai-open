/**
 * Theme Context - Theme management with dark/light mode switching
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { createModuleLogger } from '../logger';
import type { Theme, ThemeMode } from '../theme/theme';
import { darkTheme, lightTheme } from '../theme/theme';
import { loadThemeMode, storeThemeMode } from '../utils/theme-storage';

interface ThemeContextValue {
  theme: Theme;
  themeMode: ThemeMode;
  isDarkMode: boolean;
  toggleTheme: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const logger = createModuleLogger('ThemeContext');

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [isLoading, setIsLoading] = useState(true);

  // Load theme preference from storage on mount
  useEffect(() => {
    let isLoaded = false;
    let isMounted = true;

    const initTheme = async () => {
      try {
        const savedMode = await loadThemeMode();
        if (isMounted && savedMode) {
          setThemeModeState(savedMode);
        }
      } catch (error) {
        if (isMounted) {
          logger.error('Failed to load theme mode', { error });
        }
      } finally {
        isLoaded = true;
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    const timeout = setTimeout(() => {
      if (!isLoaded) {
        setIsLoading(false);
      }
    }, 500);

    void initTheme().finally(() => clearTimeout(timeout));

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await storeThemeMode(mode);
  }, []);

  const toggleTheme = useCallback(async () => {
    setThemeModeState((prev) => {
      const newMode = prev === 'dark' ? 'light' : 'dark';
      void storeThemeMode(newMode);
      return newMode;
    });
  }, []);

  const theme = themeMode === 'dark' ? darkTheme : lightTheme;
  const isDarkMode = themeMode === 'dark';

  const value: ThemeContextValue = useMemo(() => ({
    theme,
    themeMode,
    isDarkMode,
    toggleTheme,
    setThemeMode,
  }), [theme, themeMode, isDarkMode, toggleTheme, setThemeMode]);

  // Don't render children until theme is loaded to prevent flash
  if (isLoading) {
    return null;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
