import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { deepClone } from './object';

describe('utils/object', () => {
  let originalStructuredClone: typeof globalThis.structuredClone;

  beforeEach(() => {
    originalStructuredClone = globalThis.structuredClone;
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  describe('deepClone', () => {
    it('clones primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(true)).toBe(true);
      expect(deepClone(null)).toBe(null);
    });

    it('clones arrays', () => {
      const arr = [1, 2, 3];
      const cloned = deepClone(arr);
      expect(cloned).toEqual([1, 2, 3]);
      expect(cloned).not.toBe(arr);
    });

    it('clones nested arrays', () => {
      const arr = [
        [1, 2],
        [3, 4],
      ];
      const cloned = deepClone(arr);
      expect(cloned).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(cloned[0]).not.toBe(arr[0]);
    });

    it('clones objects', () => {
      const obj = { a: 1, b: 2 };
      const cloned = deepClone(obj);
      expect(cloned).toEqual({ a: 1, b: 2 });
      expect(cloned).not.toBe(obj);
    });

    it('clones nested objects', () => {
      const obj = { a: { b: { c: 1 } } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual({ a: { b: { c: 1 } } });
      expect(cloned.a).not.toBe(obj.a);
      expect(cloned.a.b).not.toBe(obj.a.b);
    });

    it('clones mixed structures', () => {
      const obj = {
        arr: [1, 2, 3],
        nested: { value: 'test' },
        primitive: 42,
      };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned.arr).not.toBe(obj.arr);
      expect(cloned.nested).not.toBe(obj.nested);
    });

    it('handles undefined', () => {
      expect(deepClone(undefined)).toBe(undefined);
    });

    it('fallback clone preserves Date values', () => {
      globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
      const input = { createdAt: new Date('2025-01-01T00:00:00.000Z') };

      const cloned = deepClone(input);

      expect(cloned.createdAt).toBeInstanceOf(Date);
      expect(cloned.createdAt.getTime()).toBe(input.createdAt.getTime());
      expect(cloned.createdAt).not.toBe(input.createdAt);
    });

    it('fallback clone preserves RegExp values', () => {
      globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
      const input = { matcher: /taskforce/gi };

      const cloned = deepClone(input);

      expect(cloned.matcher).toBeInstanceOf(RegExp);
      expect(cloned.matcher.source).toBe('taskforce');
      expect(cloned.matcher.flags).toBe('gi');
      expect(cloned.matcher).not.toBe(input.matcher);
    });

    it('fallback clone handles circular arrays', () => {
      globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
      const input: unknown[] = ['root'];
      input.push(input);

      const cloned = deepClone(input);

      expect(cloned).not.toBe(input);
      expect(cloned[0]).toBe('root');
      expect(cloned[1]).toBe(cloned);
    });

    it('fallback clone handles circular references', () => {
      globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
      const input: { id: string; self?: unknown } = { id: 'node' };
      input.self = input;

      const cloned = deepClone(input);

      expect(cloned).not.toBe(input);
      expect(cloned.id).toBe('node');
      expect(cloned.self).toBe(cloned);
    });
  });
});
