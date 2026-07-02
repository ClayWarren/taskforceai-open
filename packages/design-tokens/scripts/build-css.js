import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { colorTokens, semanticColorVariables } from '../index.js';

const write = (stream, ...parts) => {
  stream.write(`${parts.map(String).join(' ')}\n`);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outPath = path.resolve(__dirname, '../css/semantic.css');

const header = `/*
 * This file is auto-generated from packages/design-tokens/scripts/build-css.js
 * Do not edit directly. Update the tokens in packages/design-tokens/index.js instead.
 */`;

const serializeBlock = (selector, palette) => {
  const lines = Object.entries(semanticColorVariables)
    .map(([tokenKey, cssVar]) => `  ${cssVar}: ${palette[tokenKey]};`)
    .join('\n');

  return `${selector} {\n${lines}\n}`;
};

const lightSelector = ":root,\n[data-theme='light']";
const content = `${header}\n\n${serializeBlock(lightSelector, colorTokens.light)}\n\n${serializeBlock("[data-theme='dark']", colorTokens.dark)}\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content, 'utf-8');
write(process.stdout, `Wrote ${outPath}`);
