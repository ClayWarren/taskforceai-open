import { describe, expect, it } from 'bun:test';

import { definedProps } from './object';

describe('definedProps', () => {
  it('removes only undefined values', () => {
    expect(
      definedProps({
        empty: '',
        falseValue: false,
        missing: undefined,
        nil: null,
        number: 0,
      })
    ).toEqual({
      empty: '',
      falseValue: false,
      nil: null,
      number: 0,
    });
  });
});
