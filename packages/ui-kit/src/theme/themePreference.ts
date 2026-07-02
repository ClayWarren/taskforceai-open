import { getAuthLogger } from '@taskforceai/contracts/auth/logger';
import {
  readStoredThemePreferenceResult,
  type ThemePreference,
  type ThemeStorageError as ThemePreferenceError,
} from '@taskforceai/shared/preferences/theme-storage';
import { type Result, err, ok } from '@taskforceai/shared/result';

const logger = getAuthLogger();

export type { ThemePreference };

const THEME_STORAGE_KEY = 'theme';
let themeApplyFrame: number | null = null;

/**
 * Options controlling how a resolved theme is reflected onto the DOM.
 */
export interface ApplyThemeOptions {
  /**
   * Also toggle the `dark` class on the document element. Required for
   * Tailwind `dark:` variants (`@custom-variant dark (&:is(.dark *))`).
   * Defaults to `false` to preserve callers that only rely on the
   * `data-theme` attribute and body theme classes.
   */
  setDarkClass?: boolean;
}

/**
 * Read the stored theme preference from localStorage.
 */
export const readStoredThemePreference = (): Result<ThemePreference, ThemePreferenceError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Theme preference unavailable.' });
  }

  return readStoredThemePreferenceResult(
    () => {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return stored === null
          ? err({ kind: 'invalid', message: 'No stored theme preference.' })
          : ok(stored);
      } catch (error) {
        logger.error('Failed to read theme preference', { error });
        return err({ kind: 'failed', message: 'Failed to read theme preference.' });
      }
    },
    {
      readFailedMessage: 'Failed to read theme preference.',
    }
  );
};

/**
 * Resolve the system theme preference.
 */
export const readSystemThemePreference = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * Apply a theme preference to the document and persist it.
 */
export const applyThemePreference = (
  theme: ThemePreference,
  options: ApplyThemeOptions = {}
): Result<true, ThemePreferenceError> => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Theme preference unavailable.' });
  }

  try {
    const resolved = theme === 'system' ? readSystemThemePreference() : theme;
    const applyDomTheme = () => {
      document.documentElement.setAttribute('data-theme', resolved);
      if (options.setDarkClass) {
        document.documentElement.classList.toggle('dark', resolved === 'dark');
      }
      document.body.classList.toggle('dark-theme', resolved === 'dark');
      document.body.classList.toggle('light-theme', resolved === 'light');
    };
    if (typeof window.requestAnimationFrame === 'function') {
      if (themeApplyFrame !== null) {
        window.cancelAnimationFrame(themeApplyFrame);
      }
      themeApplyFrame = window.requestAnimationFrame(() => {
        applyDomTheme();
        themeApplyFrame = null;
      });
    } else {
      applyDomTheme();
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    return ok(true);
  } catch (error) {
    logger.error('Failed to apply theme preference', { error });
    return err({ kind: 'failed', message: 'Failed to apply theme preference.' });
  }
};

/**
 * Resolve the initial theme preference using storage, falling back to 'system'.
 */
export const resolveInitialThemePreference = (): ThemePreference => {
  const stored = readStoredThemePreference();
  if (stored.ok) {
    return stored.value;
  }
  return 'system';
};

/**
 * Subscribe to system theme changes.
 */
export const subscribeToSystemTheme = (
  onChange: (_theme: 'light' | 'dark') => void
): Result<() => void, ThemePreferenceError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Theme preference unavailable.' });
  }

  const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mediaQuery?.addEventListener) {
    return err({ kind: 'unavailable', message: 'Theme preference unavailable.' });
  }

  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? 'dark' : 'light');
  };

  try {
    mediaQuery.addEventListener('change', handler);
  } catch (error) {
    logger.error('Failed to subscribe to theme changes', { error });
    return err({ kind: 'failed', message: 'Failed to subscribe to theme changes.' });
  }

  return ok(() => {
    try {
      mediaQuery.removeEventListener('change', handler);
    } catch (error) {
      logger.warn('Failed to remove theme change listener', { error });
    }
  });
};

/**
 * Clear stored theme preference.
 */
export const clearThemePreference = (): Result<true, ThemePreferenceError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Theme preference unavailable.' });
  }

  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    return ok(true);
  } catch (error) {
    logger.error('Failed to clear theme preference', { error });
    return err({ kind: 'failed', message: 'Failed to clear theme preference.' });
  }
};
