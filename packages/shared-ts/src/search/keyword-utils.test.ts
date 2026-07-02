import { describe, expect, it } from 'bun:test';

import {
  extractKeywordTokens,
  normalizeQueryForCache,
  removeStructuralTokens,
} from './keyword-utils';

describe('search/keyword-utils', () => {
  describe('normalizeQueryForCache', () => {
    it('trims, lowercases, and collapses whitespace', () => {
      expect(normalizeQueryForCache('  Point   Group\nSymmetry  ')).toBe('point group symmetry');
    });
  });

  describe('extractKeywordTokens', () => {
    it('extracts canonical lowercase keyword tokens', () => {
      expect(extractKeywordTokens('Point-group symmetry for benzene')).toEqual([
        'pointgroup',
        'symmetry',
        'for',
        'benzene',
      ]);
    });

    it('preserves supported point-group tokens with digits', () => {
      expect(extractKeywordTokens('C3v C3H d3h c2v')).toEqual(['c3v', 'c3h', 'd3h']);
    });

    it('strips punctuation and deduplicates tokens in first-seen order', () => {
      expect(extractKeywordTokens('Alpha, alpha! beta_123 beta-123 BETA')).toEqual([
        'alpha',
        'beta',
      ]);
    });

    it('drops short letter-only tokens and digit-only tokens', () => {
      expect(extractKeywordTokens('a ab abc 123 12ab')).toEqual(['abc']);
    });
  });

  describe('removeStructuralTokens', () => {
    it('removes broad structure words while keeping domain tokens', () => {
      expect(removeStructuralTokens(['point', 'group', 'c3v', 'symmetry', 'benzene'])).toEqual([
        'c3v',
        'benzene',
      ]);
    });
  });
});
