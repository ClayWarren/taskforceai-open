import { describe, expect, it } from 'bun:test';

import {
  PAID_PROFILE_PLANS,
  PLAN_AGENT_LIMITS,
  getPlanAgentLimit,
  normalizeProfilePlan,
} from './plans';

describe('product plan policy', () => {
  it('defines active profile plans and agent limits', () => {
    expect(PAID_PROFILE_PLANS).toEqual(['pro', 'super']);
    expect(PLAN_AGENT_LIMITS).toEqual({
      free: 2,
      pro: 4,
      super: 16,
    });
  });

  it('normalizes external plan strings before resolving limits', () => {
    expect(normalizeProfilePlan(' SUPER ')).toBe('super');
    expect(normalizeProfilePlan('enterprise')).toBe('free');
    expect(getPlanAgentLimit(null)).toBe(2);
    expect(getPlanAgentLimit('pro')).toBe(4);
    expect(getPlanAgentLimit('super')).toBe(16);
  });
});
