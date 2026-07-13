import { getPlanAgentLimit } from '../product/plans';

export const getMaxPromptAgentCount = (userPlan?: string | null): number =>
  getPlanAgentLimit(userPlan);

export const buildPromptAgentCountOptions = (userPlan?: string | null): number[] => {
  const maxAgents = getMaxPromptAgentCount(userPlan);
  return Array.from({ length: maxAgents }, (_, index) => index + 1).filter(
    (count) => count === 1 || count % 2 === 0
  );
};

export const parsePromptBudgetInput = (value: string): number | undefined | null => {
  if (value === '') {
    return undefined;
  }

  const parsedValue = Number.parseFloat(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return parsedValue;
};
