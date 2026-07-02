import {
  colorTokens,
  radiusTokens,
  spacingTokens,
  typographyTokens,
} from '@taskforceai/design-tokens';

// Theme types
export type ThemeMode = 'dark' | 'light';

export interface Theme {
  colors: {
    background: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryHover: string;
    border: string;
    inputBackground: string;
    sidebarBackground: string;
    surface: string;
    userBubble: string;
    white: string;
    error: string;
    success: string;
    cardBackground: string;
    overlay: string;
    shadow: string;
  };
  fonts: {
    regular: string;
    medium: string;
    semibold: string;
    bold: string;
  };
  spacing: typeof spacingTokens;
  borderRadius: typeof radiusTokens;
}

const createTheme = (mode: ThemeMode): Theme => {
  const palette = colorTokens[mode];

  return {
    colors: {
      background: palette.background,
      text: palette.text,
      textMuted: palette.textMuted,
      primary: palette.primary,
      primaryHover: palette.primaryHover,
      border: palette.border,
      inputBackground: palette.input,
      sidebarBackground: palette.sidebarBackground,
      surface: palette.surface,
      userBubble: '#007aff',
      white: '#ffffff',
      error: palette.error,
      success: palette.success,
      cardBackground: mode === 'dark' ? 'rgba(45, 45, 45, 0.6)' : 'rgba(255, 255, 255, 0.9)',
      overlay: mode === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      shadow: mode === 'dark' ? '#000' : '#999',
    },
    fonts: typographyTokens.fonts,
    spacing: spacingTokens,
    borderRadius: radiusTokens,
  };
};

export const darkTheme = createTheme('dark');
export const lightTheme = createTheme('light');
