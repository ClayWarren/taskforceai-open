/**
 * Theme preference logic now lives in @taskforceai/ui-kit so web and marketing
 * share one implementation. Re-exported here to preserve existing import paths.
 */
export {
  type ThemePreference,
  type ApplyThemeOptions,
  applyThemePreference,
  clearThemePreference,
  readStoredThemePreference,
  readSystemThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from '@taskforceai/ui-kit/theme/themePreference';
