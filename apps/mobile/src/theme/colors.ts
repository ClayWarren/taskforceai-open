import { colorTokens, glassTokens } from '@taskforceai/design-tokens';

const darkPalette = colorTokens.dark;

export const colors = {
  background: darkPalette.background,
  gradientTop: glassTokens.gradient.top,
  gradientBottom: glassTokens.gradient.bottom,
  surface: glassTokens.surfaces.standard,
  surfaceStrong: glassTokens.surfaces.strong,
  border: glassTokens.border,
  primary: darkPalette.primary,
  primaryAccent: darkPalette.primaryHover,
  accent: '#8b5cf6',
  success: darkPalette.success,
  warning: darkPalette.warning,
  error: darkPalette.error,
  textPrimary: glassTokens.text.primary,
  textSecondary: glassTokens.text.secondary,
  textMuted: glassTokens.text.muted,
};
