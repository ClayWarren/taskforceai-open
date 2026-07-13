/**
 * Represents the structure of a model selection persisted in storage.
 */
export interface StoredModelSelection {
  id: string;
  label: string | null;
}

type ModelSelectionOption = {
  id: string;
  label?: string | null;
};

/**
 * Logic to determine which model should be selected based on:
 * 1. Previously stored selection (if it still exists in options)
 * 2. Backend-provided default model
 * 3. The first available option
 */
export const deriveSelectionFromOptions = (
  options: ModelSelectionOption[],
  storedSelection: StoredModelSelection | null,
  defaultModelId?: string | null
): StoredModelSelection | null => {
  if (options.length === 0) {
    return storedSelection;
  }

  const findOption = (targetId?: string | null): ModelSelectionOption | null => {
    if (!targetId) {
      return null;
    }
    return options.find((option) => option.id === targetId) ?? null;
  };

  const storedMatch = storedSelection ? findOption(storedSelection.id) : null;
  if (storedMatch) {
    return {
      id: storedMatch.id,
      label: storedMatch.label ?? storedSelection?.label ?? null,
    };
  }

  const defaultMatch = findOption(defaultModelId ?? null);
  if (defaultMatch) {
    return { id: defaultMatch.id, label: defaultMatch.label ?? null };
  }

  const firstOption = options[0];
  if (firstOption) {
    return { id: firstOption.id, label: firstOption.label ?? null };
  }

  return storedSelection;
};

/**
 * Format usage multiple (e.g., 2.5X) for display in UI.
 */
export const formatUsageMultiple = (value?: number): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const normalized =
    Number.isInteger(value) && value >= 1 ? value.toFixed(0) : Number(value.toFixed(2)).toString();
  return `${normalized}X`;
};

export interface ModelCostTier {
  symbol: '$' | '$$' | '$$$' | '$$$+';
  label: 'Low cost' | 'Medium cost' | 'High cost' | 'Very high cost';
}

/**
 * Convert an internal usage multiplier into a compact, customer-facing cost tier.
 */
export const getModelCostTier = (value?: number): ModelCostTier | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value <= 0.5) return { symbol: '$', label: 'Low cost' };
  if (value <= 1.5) return { symbol: '$$', label: 'Medium cost' };
  if (value <= 2.5) return { symbol: '$$$', label: 'High cost' };
  return { symbol: '$$$+', label: 'Very high cost' };
};

export const formatModelCostTier = (value?: number): string | null =>
  getModelCostTier(value)?.symbol ?? null;

export const hasPaidModelAccess = (plan?: string | null): boolean => {
  const normalized = plan?.trim().toLowerCase();
  return normalized === 'pro' || normalized === 'super' || normalized === 'enterprise';
};

export const modelRequiresSubscription = (usageMultiple?: number): boolean =>
  typeof usageMultiple === 'number' && Number.isFinite(usageMultiple) && usageMultiple > 1.5;

export const canUseModelForPlan = (plan?: string | null, usageMultiple?: number): boolean =>
  !modelRequiresSubscription(usageMultiple) || hasPaidModelAccess(plan);
