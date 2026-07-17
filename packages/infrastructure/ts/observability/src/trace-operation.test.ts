import { describe, expect, it } from 'bun:test';

import { createTraceOperation } from './trace-operation';

describe('createTraceOperation', () => {
  it('runs successful operations and returns their result', async () => {
    const traceOperation = createTraceOperation('@taskforceai/observability/test');

    const result = await traceOperation('test.success', async (span) => {
      span.setAttribute('test.attr', 'value');
      return 'ok';
    });

    expect(result).toBe('ok');
  });

  it('preserves operation failures', async () => {
    const traceOperation = createTraceOperation('@taskforceai/observability/test');

    await expect(
      traceOperation('test.failure', async () => {
        throw new Error('trace failure');
      })
    ).rejects.toThrow('trace failure');
  });
});
