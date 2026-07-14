const semanticColorVariables = {
  primary: '--primary-color',
  primaryHover: '--primary-hover',
  primaryRgb: '--primary-color-rgb',
  secondary: '--secondary-color',
  background: '--background-color',
  surface: '--surface-color',
  text: '--text-color',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  border: '--border-color',
  input: '--input-background',
  sidebarBackground: '--sidebar-background',
  hover: '--hover-bg',
  message: '--message-bg',
  error: '--error-color',
  errorBg: '--error-bg',
  errorBorder: '--error-border',
  success: '--success-color',
  successBg: '--success-bg',
  warning: '--warning-color',
  warningBg: '--warning-bg',
};

const colorTokens = {
  light: {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryRgb: '59, 130, 246',
    secondary: '#6b7280',
    background: '#ffffff',
    surface: '#f9fafb',
    text: '#1f2937',
    textSecondary: '#6b7280',
    textMuted: '#9ca3af',
    border: '#e5e7eb',
    input: '#ffffff',
    sidebarBackground: '#f9fafb',
    hover: '#f3f4f6',
    message: '#f3f4f6',
    error: '#dc2626',
    errorBg: '#fef2f2',
    errorBorder: '#fecaca',
    success: '#059669',
    successBg: '#f0fdf4',
    warning: '#d97706',
    warningBg: '#fffbeb',
  },
  dark: {
    primary: '#60a5fa',
    primaryHover: '#3b82f6',
    primaryRgb: '96, 165, 250',
    secondary: '#9ca3af',
    background: '#111827',
    surface: '#1f2937',
    text: '#f9fafb',
    textSecondary: '#d1d5db',
    textMuted: '#6b7280',
    border: '#374151',
    input: '#374151',
    sidebarBackground: '#252525',
    hover: '#374151',
    message: '#374151',
    error: '#f87171',
    errorBg: '#7f1d1d',
    errorBorder: '#991b1b',
    success: '#34d399',
    successBg: '#064e3b',
    warning: '#fbbf24',
    warningBg: '#78350f',
  },
};

const glassTokens = {
  gradient: {
    top: '#05060f',
    bottom: '#0d1020',
  },
  surfaces: {
    standard: 'rgba(13, 16, 24, 0.72)',
    strong: 'rgba(13, 16, 24, 0.9)',
  },
  border: 'rgba(59, 130, 246, 0.35)',
  glow: 'rgba(96, 165, 250, 0.2)',
  text: {
    primary: '#f8fafc',
    secondary: '#94a3b8',
    muted: '#64748b',
  },
};

const shadowTokens = {
  glass: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 24,
  },
};

const spacingTokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

const radiusTokens = {
  sm: 8,
  md: 12,
  lg: 20,
  full: 9999,
};

const typographyTokens = {
  fonts: {
    regular: 'InterVariable',
    medium: 'InterVariable-Medium',
    semibold: 'InterVariable-Semibold',
    bold: 'InterVariable-Bold',
  },
};

const semanticColorVars = Object.fromEntries(
  Object.entries(semanticColorVariables).map(([key, cssVar]) => [key, `var(${cssVar})`])
);

const nativewindColors = (mode = 'dark') => {
  const palette = colorTokens[mode] ?? colorTokens.dark;

  return {
    primary: palette.primary,
    'primary-hover': palette.primaryHover,
    secondary: palette.secondary,
    background: palette.background,
    surface: palette.surface,
    border: palette.border,
    input: palette.input,
    sidebar: palette.sidebarBackground,
    text: palette.text,
    'text-secondary': palette.textSecondary,
    'text-muted': palette.textMuted,
    success: palette.success,
    warning: palette.warning,
    error: palette.error,
    glass: glassTokens.surfaces.standard,
  };
};

export {
  colorTokens,
  glassTokens,
  shadowTokens,
  spacingTokens,
  radiusTokens,
  typographyTokens,
  semanticColorVariables,
  semanticColorVars,
  nativewindColors,
};
