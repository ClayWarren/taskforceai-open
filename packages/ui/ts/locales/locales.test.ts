import { describe, expect, it } from 'bun:test';

import en from './en.json';
import es from './es.json';
import packageJson from './package.json';

type LocaleValue = string | LocaleTree;
type LocaleTree = {
  [key: string]: LocaleValue;
};

const LOCALES: Record<string, LocaleTree> = {
  en,
  es,
};

const interpolateTokenPattern = /{{\s*([\w.-]+)\s*}}/g;

const sortStrings = (values: string[]): string[] => values.toSorted((a, b) => a.localeCompare(b));

const collectLeafPaths = (tree: LocaleTree, prefix = ''): string[] => {
  const paths: string[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      paths.push(path);
    } else {
      paths.push(...collectLeafPaths(value, path));
    }
  }

  return sortStrings(paths);
};

const readPath = (tree: LocaleTree, path: string): unknown =>
  path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, tree);

const collectInterpolationTokens = (value: string): string[] =>
  sortStrings(Array.from(value.matchAll(interpolateTokenPattern), (match) => match[1] ?? ''));

const collectInvalidLeaves = (tree: LocaleTree, prefix = ''): string[] => {
  const invalidPaths: string[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidPaths.push(path);
      continue;
    }

    invalidPaths.push(...collectInvalidLeaves(value, path));
  }

  return invalidPaths;
};

describe('locale catalogs', () => {
  it('keeps every locale on the same translation key contract', () => {
    const englishPaths = collectLeafPaths(en);

    for (const [locale, catalog] of Object.entries(LOCALES)) {
      expect(collectLeafPaths(catalog), locale).toEqual(englishPaths);
    }
  });

  it('keeps interpolation variables in sync across translations', () => {
    for (const key of collectLeafPaths(en)) {
      const englishValue = readPath(en, key);
      expect(typeof englishValue, `en.${key}`).toBe('string');

      for (const [locale, catalog] of Object.entries(LOCALES)) {
        const localizedValue = readPath(catalog, key);
        expect(typeof localizedValue, `${locale}.${key}`).toBe('string');
        expect(collectInterpolationTokens(localizedValue as string), `${locale}.${key}`).toEqual(
          collectInterpolationTokens(englishValue as string)
        );
      }
    }
  });

  it('contains only nested objects and string translation leaves', () => {
    for (const [locale, catalog] of Object.entries(LOCALES)) {
      expect(collectInvalidLeaves(catalog), locale).toEqual([]);
    }
  });

  it('exports every supported locale catalog from the package manifest', () => {
    const expectedFiles = sortStrings(Object.keys(LOCALES).map((locale) => `${locale}.json`));
    const packageExports = packageJson.exports as Record<string, string>;

    expect(sortStrings(packageJson.files)).toEqual(expectedFiles);
    expect(sortStrings(Object.keys(packageExports))).toEqual(
      expectedFiles.map((file) => `./${file}`)
    );

    for (const file of expectedFiles) {
      expect(packageExports[`./${file}`]).toBe(`./${file}`);
    }
  });
});
