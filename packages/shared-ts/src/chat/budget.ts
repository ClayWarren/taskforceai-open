/**
 * Shared logic for managing autonomous mode budgets and spend tracking.
 */

export interface BudgetStats {
  effectiveBudget: number | undefined | null;
  budgetPercentage: number;
  remaining: number | undefined;
}

/**
 * Calculates budget stats based on limit, current spend, and user-defined budget.
 */
export const calculateBudgetStats = (
  currentSpend: number,
  userBudget?: number,
  limit?: number | null
): BudgetStats => {
  const normalizeBudget = (value: number | null | undefined): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return undefined;
    }
    return value;
  };

  const safeCurrentSpend =
    typeof currentSpend === 'number' && Number.isFinite(currentSpend) && currentSpend > 0
      ? currentSpend
      : 0;
  const effectiveBudget = normalizeBudget(limit) ?? normalizeBudget(userBudget);
  const budgetPercentage =
    typeof effectiveBudget === 'number' && effectiveBudget > 0
      ? Math.min((safeCurrentSpend / effectiveBudget) * 100, 100)
      : 0;
  const remaining =
    typeof effectiveBudget === 'number'
      ? Math.max(0, effectiveBudget - safeCurrentSpend)
      : undefined;

  return {
    effectiveBudget,
    budgetPercentage,
    remaining,
  };
};

/**
 * Derives a color hex code based on budget exhaustion percentage.
 */
export const getBudgetColor = (percentage: number): string => {
  if (percentage >= 90) return '#ef4444'; // Red
  if (percentage >= 70) return '#eab308'; // Yellow
  return '#3b82f6'; // Blue
};
