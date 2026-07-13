import { expect, test } from 'bun:test';

import * as utils from './utils';

test('client-core utils exports the supported helper surface', () => {
  expect(Object.keys(utils).toSorted()).toEqual([
    'assertNever',
    'chunk',
    'deriveTitleFromLine',
    'extractDomain',
    'extractSourcesFromText',
    'groupBy',
    'isEmpty',
    'isValidEmail',
    'isValidUrl',
    'mergeSources',
    'omit',
    'pick',
    'sanitizeUrl',
    'sortedCopy',
    'unique',
  ]);
});
