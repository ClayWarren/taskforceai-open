import { describe, expect, it } from 'bun:test';

import { assertNever } from './assertNever';

describe('assertNever', () => {
  it('throws with default message', () => {
    expect(() => assertNever('unexpected' as never)).toThrow('Unexpected value: unexpected');
  });

  it('throws with custom message', () => {
    expect(() => assertNever('broken' as never, 'custom error')).toThrow('custom error');
  });
});
