import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  colorTokens,
  glassTokens,
  nativewindColors,
  radiusTokens,
  semanticColorVariables,
  semanticColorVars,
  shadowTokens,
  spacingTokens,
  typographyTokens,
} from './index.js';

const packageRoot = import.meta.dir;

const hexToRgbTriplet = (hex: string) => {
  const normalizedHex = hex.replace('#', '');
  const channelValues = normalizedHex.match(/.{2}/g) ?? [];

  return channelValues.map((channel) => Number.parseInt(channel, 16)).join(', ');
};

const serializeSemanticCssBlock = (selector: string, palette: Record<string, string>) => {
  const lines = Object.entries(semanticColorVariables)
    .map(([tokenKey, cssVar]) => `  ${cssVar}: ${palette[tokenKey]};`)
    .join('\n');

  return `${selector} {\n${lines}\n}`;
};

describe('design tokens', () => {
  it('keeps semantic token keys available in light and dark palettes', () => {
    const semanticKeys = Object.keys(semanticColorVariables);

    expect(Object.keys(colorTokens.light).toSorted()).toEqual(semanticKeys.toSorted());
    expect(Object.keys(colorTokens.dark).toSorted()).toEqual(semanticKeys.toSorted());
  });

  it('maps semantic color variables to CSS var references', () => {
    for (const [key, cssVar] of Object.entries(semanticColorVariables)) {
      expect(semanticColorVars[key]).toBe(`var(${cssVar})`);
    }
  });

  it('keeps primary RGB values derived from primary hex tokens', () => {
    expect(colorTokens.light.primaryRgb).toBe(hexToRgbTriplet(colorTokens.light.primary));
    expect(colorTokens.dark.primaryRgb).toBe(hexToRgbTriplet(colorTokens.dark.primary));
  });

  it('keeps generated semantic CSS in sync with token values', () => {
    const header = `/*
 * This file is auto-generated from packages/ui/ts/design-tokens/scripts/build-css.js
 * Do not edit directly. Update the tokens in packages/ui/ts/design-tokens/index.js instead.
 */`;
    const expectedCss = `${header}\n\n${serializeSemanticCssBlock(
      ":root,\n[data-theme='light']",
      colorTokens.light
    )}\n\n${serializeSemanticCssBlock("[data-theme='dark']", colorTokens.dark)}\n`;

    const semanticCssPath = path.join(packageRoot, 'css/semantic.css');

    expect(fs.readFileSync(semanticCssPath, 'utf8')).toBe(expectedCss);
  });

  it('exposes NativeWind colors for the selected palette', () => {
    expect(nativewindColors('light')).toEqual({
      primary: colorTokens.light.primary,
      'primary-hover': colorTokens.light.primaryHover,
      secondary: colorTokens.light.secondary,
      background: colorTokens.light.background,
      surface: colorTokens.light.surface,
      border: colorTokens.light.border,
      input: colorTokens.light.input,
      sidebar: colorTokens.light.sidebarBackground,
      text: colorTokens.light.text,
      'text-secondary': colorTokens.light.textSecondary,
      'text-muted': colorTokens.light.textMuted,
      success: colorTokens.light.success,
      warning: colorTokens.light.warning,
      error: colorTokens.light.error,
      glass: glassTokens.surfaces.standard,
    });

    expect(nativewindColors('dark')).toEqual({
      primary: colorTokens.dark.primary,
      'primary-hover': colorTokens.dark.primaryHover,
      secondary: colorTokens.dark.secondary,
      background: colorTokens.dark.background,
      surface: colorTokens.dark.surface,
      border: colorTokens.dark.border,
      input: colorTokens.dark.input,
      sidebar: colorTokens.dark.sidebarBackground,
      text: colorTokens.dark.text,
      'text-secondary': colorTokens.dark.textSecondary,
      'text-muted': colorTokens.dark.textMuted,
      success: colorTokens.dark.success,
      warning: colorTokens.dark.warning,
      error: colorTokens.dark.error,
      glass: glassTokens.surfaces.standard,
    });
  });

  it('falls back to dark NativeWind colors for unknown modes', () => {
    expect(nativewindColors('system' as 'dark')).toEqual(nativewindColors('dark'));
  });

  it('exposes the native layout token scales consumed by mobile config', () => {
    expect(spacingTokens).toEqual({
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 32,
      xxl: 48,
    });

    expect(radiusTokens).toEqual({
      sm: 8,
      md: 12,
      lg: 20,
      full: 9999,
    });
  });

  it('keeps exported layout token values compatible with NativeWind theme units', () => {
    const spacing = Object.fromEntries(
      Object.entries(spacingTokens).map(([key, value]) => [key, `${value / 16}rem`])
    );
    const borderRadius = Object.fromEntries(
      Object.entries(radiusTokens).map(([key, value]) => [key, `${value}px`])
    );

    expect(spacing).toEqual({
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
      xxl: '3rem',
    });
    expect(borderRadius).toEqual({
      sm: '8px',
      md: '12px',
      lg: '20px',
      full: '9999px',
    });
  });

  it('exposes typography and shadow tokens used by native surfaces', () => {
    expect(typographyTokens.fonts).toEqual({
      regular: 'InterVariable',
      medium: 'InterVariable-Medium',
      semibold: 'InterVariable-Semibold',
      bold: 'InterVariable-Bold',
    });

    expect(shadowTokens.glass).toEqual({
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.35,
      shadowRadius: 28,
      elevation: 24,
    });
  });

  it('publishes all CSS entry points used by apps', () => {
    const manifestPath = path.join(packageRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      exports: Record<string, unknown>;
      files: string[];
    };

    expect(manifest.files).toContain('css/semantic.css');
    expect(manifest.files).toContain('css/animations.css');
    expect(manifest.files).toContain('css/app-theme.css');
    expect(manifest.files).toContain('css/app-tailwind.css');
    expect(manifest.files).toContain('css/app-globals-shared.css');
    expect(Object.hasOwn(manifest.exports, './css/semantic.css')).toBe(true);
    expect(Object.hasOwn(manifest.exports, './css/animations.css')).toBe(true);
    expect(Object.hasOwn(manifest.exports, './css/app-theme.css')).toBe(true);
    expect(Object.hasOwn(manifest.exports, './css/app-tailwind.css')).toBe(true);
    expect(Object.hasOwn(manifest.exports, './css/app-globals-shared.css')).toBe(true);
  });

  it('keeps dark sidebar semantic variables readable across themes', () => {
    const appGlobalsPath = path.join(packageRoot, 'css/app-globals-shared.css');
    const appGlobals = fs.readFileSync(appGlobalsPath, 'utf8');

    expect(appGlobals).toContain('.sidebar {\n  --text-color: #e2e8f0;');
    expect(appGlobals).toContain('  --text-secondary: #cbd5e1;');
    expect(appGlobals).toContain('  --text-muted: #94a3b8;');
    expect(appGlobals).toContain('  --hover-bg: rgba(148, 163, 184, 0.12);');
  });
});
