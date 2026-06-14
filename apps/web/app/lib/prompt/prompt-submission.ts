import { buildRateLimitUpgradeMessage } from '@taskforceai/shared/utils';

export const getRateLimitResetTime = (error: { resetTime?: string }): string | undefined => {
  return error.resetTime;
};

export const getRateLimitMessage = (plan?: string | null): string => {
  return buildRateLimitUpgradeMessage(plan);
};
