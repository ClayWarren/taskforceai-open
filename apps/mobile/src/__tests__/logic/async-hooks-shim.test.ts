import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';

const { AsyncLocalStorage } = require('../../../shims/async_hooks');

describe('mobile AsyncLocalStorage shim', () => {
  it('keeps the store available until an async callback settles', async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];

    await storage.run('request-1', async () => {
      seen.push(storage.getStore());
      await Promise.resolve();
      seen.push(storage.getStore());
    });

    seen.push(storage.getStore());
    assert.deepStrictEqual(seen, ['request-1', 'request-1', undefined]);
  });

  it('restores the previous store after nested async callbacks', async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];

    await storage.run('outer', async () => {
      seen.push(storage.getStore());
      await storage.run('inner', async () => {
        seen.push(storage.getStore());
        await Promise.resolve();
        seen.push(storage.getStore());
      });
      seen.push(storage.getStore());
    });

    seen.push(storage.getStore());
    assert.deepStrictEqual(seen, ['outer', 'inner', 'inner', 'outer', undefined]);
  });

  it('restores the previous store when callbacks throw', () => {
    const storage = new AsyncLocalStorage<string>();

    assert.throws(() => {
      storage.run('request-1', () => {
        throw new Error('boom');
      });
    }, /boom/);
    assert.equal(storage.getStore(), undefined);
  });
});
