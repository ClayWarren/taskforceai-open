import { describe, expect, it, mock } from 'bun:test';

import { createLazyAsyncProxy, createLazyResourceLoader } from './lazy-resource';

describe('lazy-resource', () => {
  it('loads a resource once and exposes the resolved value', async () => {
    const load = mock(async () => ({ value: 42 }));
    const loader = createLazyResourceLoader(load);

    expect(loader.getResolved()).toBeNull();
    const first = await loader.get();
    const second = await loader.get();

    expect(first).toEqual({ value: 42 });
    expect(second).toBe(first);
    expect(loader.getResolved()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed load', async () => {
    const load = mock(async () => {
      if (load.mock.calls.length === 1) {
        throw new Error('not yet');
      }
      return 'ready';
    });
    const loader = createLazyResourceLoader(load);

    await expect(loader.get()).rejects.toThrow('not yet');

    expect(await loader.get()).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches falsey resolved values', async () => {
    const load = mock(async () => 0);
    const loader = createLazyResourceLoader(load);

    expect(await loader.get()).toBe(0);
    expect(await loader.get()).toBe(0);
    expect(loader.getResolved()).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('proxies async method and property access', async () => {
    const proxy = createLazyAsyncProxy(async () => ({
      label: 'resource',
      greet: (name: string) => `hello ${name}`,
    }));

    expect(await proxy.greet('Clay')).toBe('hello Clay');
    expect(await (proxy as unknown as { label: () => Promise<string> }).label()).toBe('resource');
    expect((proxy as unknown as Promise<unknown>).then).toBeUndefined();
  });
});
