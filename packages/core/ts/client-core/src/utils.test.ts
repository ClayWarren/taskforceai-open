import { describe, expect, it } from 'bun:test';

import { chunk, groupBy, isEmpty, isValidEmail, isValidUrl, omit, pick, unique } from './utils';

describe('client-core utils', () => {
  describe('validation helpers', () => {
    it('validates email and url formats', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('data:text/html,test')).toBe(false);
    });
  });

  describe('collection helpers', () => {
    it('groups, deduplicates, chunks, and clones data', () => {
      const input = [
        { category: 'a', value: 1 },
        { category: 'b', value: 2 },
        { category: 'a', value: 3 },
      ];
      const grouped = groupBy(input, 'category');
      expect(grouped['a']).toHaveLength(2);
      expect(unique(['x', 'x', 'y'])).toEqual(['x', 'y']);
      expect(chunk([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('evaluates emptiness and object picks/omits', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(isEmpty({})).toBe(true);
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('edge cases', () => {
    it('groupBy works with function key selector', () => {
      const input = [{ value: 1 }, { value: 2 }, { value: 3 }];
      const grouped = groupBy(input, (item) => (item.value % 2 === 0 ? 'even' : 'odd'));
      expect(grouped['odd']).toHaveLength(2);
      expect(grouped['even']).toHaveLength(1);
    });
  });
});
