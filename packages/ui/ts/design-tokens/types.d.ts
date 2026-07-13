export interface SemanticColorSet {
  primary: string;
  primaryHover: string;
  primaryRgb: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  input: string;
  sidebarBackground: string;
  hover: string;
  message: string;
  error: string;
  errorBg: string;
  errorBorder: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
}

export interface GlassTokens {
  gradient: {
    top: string;
    bottom: string;
  };
  surfaces: {
    standard: string;
    strong: string;
  };
  border: string;
  glow: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
}

export interface ShadowTokens {
  glass: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface RadiusTokens {
  sm: number;
  md: number;
  lg: number;
  full: number;
}

export interface TypographyTokens {
  fonts: {
    regular: string;
    medium: string;
    semibold: string;
    bold: string;
  };
}

export type SemanticColorName = keyof SemanticColorSet;

export type NativewindColorName =
  | 'primary'
  | 'primary-hover'
  | 'secondary'
  | 'background'
  | 'surface'
  | 'border'
  | 'input'
  | 'sidebar'
  | 'text'
  | 'text-secondary'
  | 'text-muted'
  | 'success'
  | 'warning'
  | 'error'
  | 'glass';

export type NativewindColorMap = Record<NativewindColorName, string>;

export declare const colorTokens: { light: SemanticColorSet; dark: SemanticColorSet };
export declare const glassTokens: GlassTokens;
export declare const shadowTokens: ShadowTokens;
export declare const spacingTokens: SpacingTokens;
export declare const radiusTokens: RadiusTokens;
export declare const typographyTokens: TypographyTokens;
export declare const semanticColorVariables: Record<SemanticColorName, string>;
export declare const semanticColorVars: Record<SemanticColorName, string>;
export declare function nativewindColors(mode?: 'light' | 'dark'): NativewindColorMap;
