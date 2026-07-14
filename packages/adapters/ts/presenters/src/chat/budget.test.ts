import { describe, expect, it } from 'bun:test';

import { getBudgetColor } from './budget';

describe('getBudgetColor', () => {
  it('maps budget thresholds to presentation colors', () => {
    expect(getBudgetColor(69.99)).toBe('#3b82f6');
    expect(getBudgetColor(70)).toBe('#eab308');
    expect(getBudgetColor(90)).toBe('#ef4444');
  });
});
