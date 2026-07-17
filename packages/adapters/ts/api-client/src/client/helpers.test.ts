import { describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';

import { createRequestContext } from '../request';
import { createHelpers } from './helpers';

const fetchMock = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch;

describe('contracts-ts/client helpers', () => {
  it('returns ok results for falsy parsed values', async () => {
    const { result } = createHelpers(createRequestContext({ fetchImpl: fetchMock }));

    const parsed = await result(z.literal(false), async () => false);

    expect(parsed).toEqual({ ok: true, value: false });
  });
});
