import { describe, expect, it } from 'bun:test';

import {
  VERCEL_FUNCTION_MAX_DURATION_MS,
  VERCEL_FUNCTION_MAX_DURATION_SECONDS,
  VERCEL_FUNCTION_PAYLOAD_LIMIT_BYTES,
  VERCEL_FUNCTION_SAFE_JSON_PAYLOAD_BYTES,
} from './platform-limits';

describe('platform limits', () => {
  it('encodes Vercel function payload and duration budgets', () => {
    expect(VERCEL_FUNCTION_PAYLOAD_LIMIT_BYTES).toBe(4_500_000);
    expect(VERCEL_FUNCTION_SAFE_JSON_PAYLOAD_BYTES).toBe(3 * 1024 * 1024);
    expect(VERCEL_FUNCTION_MAX_DURATION_SECONDS).toBe(800);
    expect(VERCEL_FUNCTION_MAX_DURATION_MS).toBe(800_000);
  });
});
