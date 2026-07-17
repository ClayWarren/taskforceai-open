import { describe, expect, it } from 'bun:test';

import { calculateBudgetStats } from './budget';

describe('chat/budget', () => {
  describe('calculateBudgetStats', () => {
    it('calculates percentage and remaining for valid inputs', () => {
      const stats = calculateBudgetStats(25, 100);

      expect(stats.effectiveBudget).toBe(100);
      expect(stats.budgetPercentage).toBe(25);
      expect(stats.remaining).toBe(75);
    });

    it('clamps negative current spend to zero', () => {
      const stats = calculateBudgetStats(-5, 50);

      expect(stats.budgetPercentage).toBe(0);
      expect(stats.remaining).toBe(50);
    });

    it('treats non-finite current spend as zero', () => {
      const stats = calculateBudgetStats(Number.NaN, 20, null);

      expect(stats.effectiveBudget).toBe(20);
      expect(stats.budgetPercentage).toBe(0);
      expect(stats.remaining).toBe(20);
    });

    it('ignores invalid limit values and falls back to user budget', () => {
      const stats = calculateBudgetStats(10, 30, Number.NaN);

      expect(stats.effectiveBudget).toBe(30);
      expect(stats.budgetPercentage).toBeCloseTo(33.3333333333, 5);
      expect(stats.remaining).toBe(20);
    });

    it('prefers a valid limit over the user budget and caps exhaustion at 100%', () => {
      const stats = calculateBudgetStats(125, 200, 100);

      expect(stats.effectiveBudget).toBe(100);
      expect(stats.budgetPercentage).toBe(100);
      expect(stats.remaining).toBe(0);
    });

    it('returns no remaining budget when both limit and user budget are invalid', () => {
      const stats = calculateBudgetStats(25, -10, null);

      expect(stats.effectiveBudget).toBeUndefined();
      expect(stats.budgetPercentage).toBe(0);
      expect(stats.remaining).toBeUndefined();
    });
  });
});
