import { buildRateLimitUpgradeMessage } from '@taskforceai/presenters/utils/text';

export const getRateLimitResetTime = (error: { resetTime?: string }): string | undefined => {
  return error.resetTime;
};

export const getRateLimitMessage = (plan?: string | null): string => {
  return buildRateLimitUpgradeMessage(plan);
};
