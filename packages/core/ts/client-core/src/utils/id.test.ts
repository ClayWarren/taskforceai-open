import { describe, expect, it } from 'bun:test';

import { createId } from './id';

describe('utils/id', () => {
  it('creates ids by prefixing the injected uuid generator output', () => {
    const rng = {
      random: () => 0.5,
      uuid: () => '123e4567-e89b-12d3-a456-426614174000',
    };

    expect(createId('msg', rng)).toBe('msg-123e4567-e89b-12d3-a456-426614174000');
  });
});
