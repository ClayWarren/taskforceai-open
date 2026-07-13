/**
 * Theme Tests - Test dark/light theme definitions and structure
 */
import { describe, it } from '@jest/globals';
import { colorTokens, radiusTokens, spacingTokens } from '@taskforceai/design-tokens';
import assert from 'node:assert/strict';

import { darkTheme, lightTheme } from '../../theme/theme';

const hexToLuminance = (hex: string): number => {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const rLin = linear[0];
  const gLin = linear[1];
  const bLin = linear[2];
  if (rLin === undefined || gLin === undefined || bLin === undefined) {
    throw new Error('Expected RGB components to be defined');
  }
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
};

describe('Theme tokens', () => {
  it('match the design system contract', () => {
    assert.ok(darkTheme, 'darkTheme should be defined');
    assert.ok(lightTheme, 'lightTheme should be defined');

    assert.equal(
      darkTheme.colors.background,
      colorTokens.dark.background,
      'dark theme background should match tokens'
    );
    assert.equal(
      darkTheme.colors.text,
      colorTokens.dark.text,
      'dark theme text should match tokens'
    );
    assert.equal(
      darkTheme.colors.textMuted,
      colorTokens.dark.textMuted,
      'dark theme muted text should match tokens'
    );
    assert.equal(
      darkTheme.colors.primary,
      colorTokens.dark.primary,
      'dark theme primary should match tokens'
    );
    assert.equal(
      darkTheme.colors.border,
      colorTokens.dark.border,
      'dark theme border should match tokens'
    );
    assert.equal(
      darkTheme.colors.surface,
      colorTokens.dark.surface,
      'dark theme surface should match tokens'
    );

    assert.equal(
      lightTheme.colors.background,
      colorTokens.light.background,
      'light theme background should match tokens'
    );
    assert.equal(
      lightTheme.colors.text,
      colorTokens.light.text,
      'light theme text should match tokens'
    );
    assert.equal(
      lightTheme.colors.textMuted,
      colorTokens.light.textMuted,
      'light theme muted text should match tokens'
    );
    assert.equal(
      lightTheme.colors.primary,
      colorTokens.light.primary,
      'light theme primary should match tokens'
    );
    assert.equal(
      lightTheme.colors.border,
      colorTokens.light.border,
      'light theme border should match tokens'
    );
    assert.equal(
      lightTheme.colors.surface,
      colorTokens.light.surface,
      'light theme surface should match tokens'
    );

    const requiredColorKeys: Array<keyof typeof darkTheme.colors> = [
      'background',
      'text',
      'textMuted',
      'primary',
      'primaryHover',
      'border',
      'inputBackground',
      'sidebarBackground',
      'surface',
      'userBubble',
      'white',
      'error',
      'success',
      'cardBackground',
      'overlay',
      'shadow',
    ];

    for (const key of requiredColorKeys) {
      assert.ok(darkTheme.colors[key], `darkTheme should have color: ${key}`);
      assert.ok(lightTheme.colors[key], `lightTheme should have color: ${key}`);
    }

    assert.deepStrictEqual(
      darkTheme.spacing,
      lightTheme.spacing,
      'both themes should have identical spacing'
    );
    assert.equal(darkTheme.spacing.xs, spacingTokens.xs, 'xs spacing should match design tokens');
    assert.equal(darkTheme.spacing.sm, spacingTokens.sm, 'sm spacing should match design tokens');
    assert.equal(darkTheme.spacing.md, spacingTokens.md, 'md spacing should match design tokens');
    assert.equal(darkTheme.spacing.lg, spacingTokens.lg, 'lg spacing should match design tokens');
    assert.equal(darkTheme.spacing.xl, spacingTokens.xl, 'xl spacing should match design tokens');

    assert.deepStrictEqual(
      darkTheme.borderRadius,
      lightTheme.borderRadius,
      'both themes should have identical borderRadius'
    );
    assert.equal(darkTheme.borderRadius.sm, radiusTokens.sm, 'sm borderRadius should match tokens');
    assert.equal(darkTheme.borderRadius.md, radiusTokens.md, 'md borderRadius should match tokens');
    assert.equal(darkTheme.borderRadius.lg, radiusTokens.lg, 'lg borderRadius should match tokens');
    assert.equal(
      darkTheme.borderRadius.full,
      radiusTokens.full,
      'full borderRadius should match tokens'
    );

    assert.deepStrictEqual(
      darkTheme.fonts,
      lightTheme.fonts,
      'both themes should have identical fonts'
    );

    assert.ok(
      hexToLuminance(darkTheme.colors.background) < hexToLuminance(darkTheme.colors.text),
      'dark theme: background should be darker than text'
    );
    assert.ok(
      hexToLuminance(lightTheme.colors.background) > hexToLuminance(lightTheme.colors.text),
      'light theme: background should be lighter than text'
    );
  });
});
