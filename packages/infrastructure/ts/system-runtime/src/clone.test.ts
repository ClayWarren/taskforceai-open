import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { deepClone } from './clone';

describe('deepClone', () => {
  let originalStructuredClone: typeof globalThis.structuredClone;

  beforeEach(() => {
    originalStructuredClone = globalThis.structuredClone;
  });

  afterEach(() => {
    globalThis.structuredClone = originalStructuredClone;
  });

  it('clones primitive and undefined values', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(true)).toBe(true);
    expect(deepClone(null)).toBe(null);
    expect(deepClone(undefined)).toBe(undefined);
  });

  it('creates independent copies of nested arrays and objects', () => {
    const original = {
      arr: [
        [1, 2],
        [3, 4],
      ],
      nested: { value: 'test' },
      primitive: 42,
    };
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.arr).not.toBe(original.arr);
    expect(cloned.arr[0]).not.toBe(original.arr[0]);
    expect(cloned.nested).not.toBe(original.nested);
  });

  it('uses the fallback when structuredClone is unavailable', () => {
    globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
    const original = { nested: ['value'] };
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
  });

  it('fallback clone preserves Date and RegExp values', () => {
    globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
    const input = {
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      matcher: /taskforce/gi,
    };
    const cloned = deepClone(input);

    expect(cloned.createdAt).toBeInstanceOf(Date);
    expect(cloned.createdAt.getTime()).toBe(input.createdAt.getTime());
    expect(cloned.createdAt).not.toBe(input.createdAt);
    expect(cloned.matcher).toBeInstanceOf(RegExp);
    expect(cloned.matcher.source).toBe('taskforce');
    expect(cloned.matcher.flags).toBe('gi');
    expect(cloned.matcher).not.toBe(input.matcher);
  });

  it('fallback clone handles circular arrays and objects', () => {
    globalThis.structuredClone = undefined as unknown as typeof globalThis.structuredClone;
    const array: unknown[] = ['root'];
    array.push(array);
    const object: { id: string; self?: unknown } = { id: 'node' };
    object.self = object;

    const clonedArray = deepClone(array);
    const clonedObject = deepClone(object);

    expect(clonedArray).not.toBe(array);
    expect(clonedArray[0]).toBe('root');
    expect(clonedArray[1]).toBe(clonedArray);
    expect(clonedObject).not.toBe(object);
    expect(clonedObject.self).toBe(clonedObject);
  });
});
