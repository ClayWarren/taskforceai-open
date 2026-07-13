import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { configurePersistenceTracing, traceOperation } from './trace-operation';

describe('persistence/trace-operation', () => {
  beforeEach(() => {
    configurePersistenceTracing();
  });

  it('runs operations through the default no-op span', async () => {
    const result = await traceOperation('test.success', async (span) => {
      span.setAttribute('test.attr', 'value');
      return 'ok';
    });

    expect(result).toBe('ok');
  });

  it('delegates tracing to the configured implementation', async () => {
    const setAttribute = vi.fn();
    const implementation = vi.fn(async (_spanName, operation) => await operation({ setAttribute }));
    configurePersistenceTracing(implementation);

    await traceOperation('test.configured', async (span) => {
      span.setAttribute('test.attr', 42);
    });

    expect(implementation).toHaveBeenCalledWith('test.configured', expect.any(Function));
    expect(setAttribute).toHaveBeenCalledWith('test.attr', 42);
  });

  it('preserves operation failures', async () => {
    await expect(
      traceOperation('test.failure', async () => {
        throw new Error('trace failure');
      })
    ).rejects.toThrow('trace failure');
  });
});
