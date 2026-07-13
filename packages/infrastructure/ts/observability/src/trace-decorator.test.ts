import { describe, expect, it } from 'bun:test';

import { Trace } from './trace-decorator';

describe('observability/trace-decorator', () => {
  it('preserves synchronous return values', () => {
    const wrapped = Trace()(
      function add(a: number, b: number) {
        return a + b;
      } as (...args: unknown[]) => unknown,
      { name: 'add' } as ClassMethodDecoratorContext
    );

    const result = wrapped.call({ constructor: { name: 'Calculator' } }, 1, 2);

    expect(result).toBe(3);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('preserves null synchronous return values', () => {
    const wrapped = Trace()(
      function getNothing() {
        return null;
      } as (...args: unknown[]) => unknown,
      { name: 'getNothing' } as ClassMethodDecoratorContext
    );

    expect(wrapped.call({ constructor: { name: 'Calculator' } })).toBeNull();
  });

  it('preserves synchronous throw behavior', () => {
    const wrapped = Trace()(
      function explode() {
        throw new Error('sync boom');
      } as (...args: unknown[]) => unknown,
      { name: 'explode' } as ClassMethodDecoratorContext
    );

    expect(() => wrapped.call({ constructor: { name: 'Calculator' } })).toThrow('sync boom');
  });

  it('preserves promise behavior for async methods', async () => {
    const wrapped = Trace()(
      async function addAsync(a: number, b: number) {
        return a + b;
      } as (...args: unknown[]) => unknown,
      { name: 'addAsync' } as ClassMethodDecoratorContext
    );

    const result = wrapped.call({ constructor: { name: 'Calculator' } }, 2, 3);

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(5);
  });

  it('preserves rejected promise behavior for async methods', async () => {
    const wrapped = Trace()(
      async function failAsync() {
        throw new Error('async boom');
      } as (...args: unknown[]) => unknown,
      { name: 'failAsync' } as ClassMethodDecoratorContext
    );

    await expect(wrapped.call({ constructor: { name: 'Calculator' } })).rejects.toThrow(
      'async boom'
    );
  });
});
