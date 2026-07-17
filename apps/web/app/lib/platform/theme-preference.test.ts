import { describe, expect, it } from 'bun:test';

import * as canonicalThemePreference from '@taskforceai/ui-kit/theme/themePreference';

import {
  applyThemePreference,
  clearThemePreference,
  readStoredThemePreference,
  readSystemThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from './theme-preference';
import type { ApplyThemeOptions, ThemePreference } from './theme-preference';

describe('theme-preference compatibility facade', () => {
  it('re-exports the canonical theme preference contract', () => {
    const preference: ThemePreference = 'system';
    const options: ApplyThemeOptions = { setDarkClass: true };

    expect({
      applyThemePreference,
      clearThemePreference,
      readStoredThemePreference,
      readSystemThemePreference,
      resolveInitialThemePreference,
      subscribeToSystemTheme,
    }).toEqual({
      applyThemePreference: canonicalThemePreference.applyThemePreference,
      clearThemePreference: canonicalThemePreference.clearThemePreference,
      readStoredThemePreference: canonicalThemePreference.readStoredThemePreference,
      readSystemThemePreference: canonicalThemePreference.readSystemThemePreference,
      resolveInitialThemePreference: canonicalThemePreference.resolveInitialThemePreference,
      subscribeToSystemTheme: canonicalThemePreference.subscribeToSystemTheme,
    });
    expect({ preference, options }).toEqual({
      preference: 'system',
      options: { setDarkClass: true },
    });
  });
});
