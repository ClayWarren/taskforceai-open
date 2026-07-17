import {
  type UpgradePlan,
  startUpgradeCheckout,
} from '@taskforceai/api-client/services/upgrade-flow';

export type { UpgradePlan };

export const startPlanUpgradeCheckout = async (targetPlan: UpgradePlan) => {
  return startUpgradeCheckout({ targetPlan });
};
