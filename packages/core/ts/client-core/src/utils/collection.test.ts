import { describe, expect, it } from 'bun:test';

import {
  chunk,
  countBy,
  flatMap,
  groupBy,
  isEmpty,
  omit,
  pick,
  sortedCopy,
  unique,
} from './collection';

describe('utils/collection', () => {
  describe('groupBy', () => {
    it('groups by property key', () => {
      const items = [
        { type: 'a', value: 1 },
        { type: 'b', value: 2 },
        { type: 'a', value: 3 },
      ];
      expect(groupBy(items, 'type')).toEqual({
        a: [
          { type: 'a', value: 1 },
          { type: 'a', value: 3 },
        ],
        b: [{ type: 'b', value: 2 }],
      });
    });

    it('groups by function', () => {
      const items = [1, 2, 3, 4, 5, 6];
      expect(groupBy(items, (n) => (n % 2 === 0 ? 'even' : 'odd'))).toEqual({
        odd: [1, 3, 5],
        even: [2, 4, 6],
      });
    });

    it('handles numeric keys', () => {
      const items = [
        { category: 1, name: 'a' },
        { category: 2, name: 'b' },
        { category: 1, name: 'c' },
      ];
      expect(groupBy(items, 'category')).toEqual({
        '1': [
          { category: 1, name: 'a' },
          { category: 1, name: 'c' },
        ],
        '2': [{ category: 2, name: 'b' }],
      });
    });

    it('normalizes symbol and object key values', () => {
      const symbolKey = Symbol.for('priority');
      const items = [
        { category: symbolKey, name: 'symbol' },
        { category: { nested: true }, name: 'object' },
        { category: null, name: 'null' },
      ];

      expect(groupBy(items, 'category')).toEqual({
        'Symbol(priority)': [{ category: symbolKey, name: 'symbol' }],
        '{"nested":true}': [{ category: { nested: true }, name: 'object' }],
        '""': [{ category: null, name: 'null' }],
      });
    });

    it('handles null/undefined values in key', () => {
      const items = [
        { category: null, name: 'a' },
        { category: undefined, name: 'b' },
      ];
      const result = groupBy(items, 'category');
      expect(Object.keys(result).length).toBeGreaterThan(0);
    });

    it('handles empty array', () => {
      expect(groupBy([], 'key')).toEqual({});
    });

    it('falls back when Object.groupBy is unavailable', () => {
      const originalGroupBy = Object.groupBy;
      Object.groupBy = undefined as unknown as typeof Object.groupBy;

      try {
        expect(groupBy([{ tag: 'a' }, { tag: 'a' }], 'tag')).toEqual({
          a: [{ tag: 'a' }, { tag: 'a' }],
        });
      } finally {
        Object.groupBy = originalGroupBy;
      }
    });

    it('handles prototype-like keys safely', () => {
      const items = [
        { category: '__proto__', value: 1 },
        { category: 'constructor', value: 2 },
      ];

      const grouped = groupBy(items, 'category');

      expect(grouped['__proto__']).toEqual([{ category: '__proto__', value: 1 }]);
      expect(grouped['constructor']).toEqual([{ category: 'constructor', value: 2 }]);
    });
  });

  describe('unique', () => {
    it('removes duplicate values', () => {
      expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
    });

    it('works with strings', () => {
      expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('preserves order', () => {
      expect(unique([3, 1, 2, 1, 3])).toEqual([3, 1, 2]);
    });

    it('handles empty array', () => {
      expect(unique([])).toEqual([]);
    });
  });

  describe('sortedCopy', () => {
    it('sorts without mutating the source array', () => {
      const values = [3, 1, 2];

      expect(sortedCopy(values, (left, right) => left - right)).toEqual([1, 2, 3]);
      expect(values).toEqual([3, 1, 2]);
    });

    it('does not depend on Array.prototype.toSorted', () => {
      const arrayPrototype = Array.prototype as unknown as {
        toSorted?: (...args: unknown[]) => unknown;
      };
      const originalToSorted = arrayPrototype.toSorted;
      Object.defineProperty(arrayPrototype, 'toSorted', {
        configurable: true,
        value: () => {
          throw new Error('toSorted unavailable');
        },
      });

      try {
        expect(sortedCopy(['b', 'a'])).toEqual(['a', 'b']);
      } finally {
        if (originalToSorted) {
          Object.defineProperty(arrayPrototype, 'toSorted', {
            configurable: true,
            value: originalToSorted,
          });
        } else {
          delete arrayPrototype.toSorted;
        }
      }
    });
  });

  describe('chunk', () => {
    it('splits array into chunks', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('handles exact chunk sizes', () => {
      expect(chunk([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('handles chunk size larger than array', () => {
      expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    });

    it('handles empty array', () => {
      expect(chunk([], 2)).toEqual([]);
    });

    it('handles chunk size of 1', () => {
      expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    });

    it('throws for zero chunk size', () => {
      expect(() => chunk([1, 2, 3], 0)).toThrow(RangeError);
    });

    it('throws for negative chunk size', () => {
      expect(() => chunk([1, 2, 3], -1)).toThrow(RangeError);
    });

    it('throws for non-integer chunk size', () => {
      expect(() => chunk([1, 2, 3], 1.5)).toThrow(RangeError);
    });
  });

  describe('isEmpty', () => {
    it('returns true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('returns false for non-empty object', () => {
      expect(isEmpty({ a: 1 })).toBe(false);
    });

    it('returns true for empty array', () => {
      expect(isEmpty([])).toBe(true);
    });

    it('returns false for non-empty array', () => {
      expect(isEmpty([1])).toBe(false);
    });
  });

  describe('pick', () => {
    it('picks specified keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });

    it('ignores missing keys', () => {
      const obj: { a: number; b: number; c?: number } = { a: 1, b: 2 };
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1 });
    });

    it('handles empty keys array', () => {
      expect(pick({ a: 1 }, [])).toEqual({});
    });
  });

  describe('omit', () => {
    it('omits specified keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });

    it('handles multiple keys', () => {
      const obj = { a: 1, b: 2, c: 3, d: 4 };
      expect(omit(obj, ['a', 'c'])).toEqual({ b: 2, d: 4 });
    });

    it('handles empty keys array', () => {
      const obj = { a: 1, b: 2 };
      expect(omit(obj, [])).toEqual({ a: 1, b: 2 });
    });
  });

  it('flatMaps values with indexes', () => {
    expect(flatMap(['a', 'b'], (value, index) => [value, String(index)])).toEqual([
      'a',
      '0',
      'b',
      '1',
    ]);
  });

  it('counts values by derived key', () => {
    expect(countBy(['apple', 'apricot', 'banana'], (value) => value[0]!)).toEqual({
      a: 2,
      b: 1,
    });
  });
});
