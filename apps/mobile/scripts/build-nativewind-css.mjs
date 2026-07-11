#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { nativewindColors, radiusTokens, spacingTokens } from '@taskforceai/design-tokens';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(projectRoot, 'nativewind.tailwind.css');
const outputPath = path.join(projectRoot, 'nativewind.generated.css');

const toRem = (value) => {
  const rem = value / 16;
  const normalized = Number(rem.toFixed(4));
  return `${normalized}rem`;
};

const createThemeBlock = () => {
  const colorEntries = Object.entries(nativewindColors('dark')).map(
    ([key, value]) => `  --color-${key}: ${String(value)};`
  );

  const spacingEntries = Object.entries(spacingTokens).map(
    ([key, value]) => `  --spacing-${key}: ${toRem(value)};`
  );

  const radiusEntries = Object.entries(radiusTokens).map(
    ([key, value]) => `  --radius-${key}: ${String(value)}px;`
  );

  return ['@theme {', ...colorEntries, ...spacingEntries, ...radiusEntries, '}'].join('\n');
};

const loadPlugins = async () => {
  const configModule = await import('../postcss.config.mjs');
  const config = configModule.default ?? configModule;
  return Promise.all(
    config.plugins.map(async (entry) => {
      if (Array.isArray(entry)) {
        const [name, options] = entry;
        const mod = await import(name);
        return (mod.default ?? mod)(options);
      }
      if (typeof entry === 'function') {
        return entry;
      }
      return entry;
    })
  );
};

const main = async () => {
  const css = await fs.readFile(inputPath, 'utf8');
  const themeBlock = createThemeBlock();
  const cssWithTheme = css.includes('/* @nativewind-theme */')
    ? css.replace('/* @nativewind-theme */', `${themeBlock}\n`)
    : `${themeBlock}\n${css}`;
  const plugins = await loadPlugins();
  const processor = postcss(plugins);
  const result = await processor.process(cssWithTheme, { from: 'nativewind.tailwind.css' });
  await fs.writeFile(outputPath, result.css);
  process.stdout.write(`[nativewind] wrote ${outputPath}\n`);
};

main().catch((error) => {
  console.error('[nativewind] failed to build CSS', error);
  process.exitCode = 1;
});
