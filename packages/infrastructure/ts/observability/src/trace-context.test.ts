import { describe, expect, it } from 'bun:test';

import { injectActiveTraceContext } from './trace-context';

describe('injectActiveTraceContext', () => {
  it('accepts a header-compatible carrier', () => {
    const headers = new Headers();

    expect(() => injectActiveTraceContext(headers)).not.toThrow();
  });
});
