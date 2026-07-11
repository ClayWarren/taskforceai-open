import type { ProductSummary } from '@taskforceai/contracts/contracts';
import {
  cancelProfileSubscription,
  reactivateProfileSubscription,
} from '@taskforceai/api-client/services/profile-service';
import { startUpgradeCheckout } from '@taskforceai/api-client/services/upgrade-flow';
import { navigateTo } from '@taskforceai/browser-runtime/browser-actions';

import { logger } from '../logger';

interface UseProfileSubscriptionActionsOptions {
  loadProfile: () => Promise<void>;
  products: ProductSummary[];
  setFeedbackKind: (kind: 'success' | 'error') => void;
  setFeedbackMessage: (message: string | null) => void;
  setLoading: (loading: boolean) => void;
  setPendingUpgradePlan: (plan: 'pro' | 'super' | null) => void;
}

export const useProfileSubscriptionActions = ({
  loadProfile,
  products,
  setFeedbackKind,
  setFeedbackMessage,
  setLoading,
  setPendingUpgradePlan,
}: UseProfileSubscriptionActionsOptions) => {
  const handleUpgrade = async (targetPlan: 'pro' | 'super', priceId?: string | null) => {
    if (!priceId) {
      setFeedbackKind('error');
      setFeedbackMessage('Upgrade link is temporarily unavailable. Please try again later.');
      return;
    }
    setPendingUpgradePlan(targetPlan);
    try {
      const result = await startUpgradeCheckout({
        targetPlan,
        priceId,
        products,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      const navigationResult = navigateTo(result.value.checkoutUrl);
      if (!navigationResult.ok) {
        throw new Error(navigationResult.error.message);
      }
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to create subscription', { error: normalizedError });
    } finally {
      setPendingUpgradePlan(null);
    }
  };

  const handleCancelSubscription = async () => {
    setLoading(true);
    try {
      const result = await cancelProfileSubscription();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      await loadProfile();
      if (result.value.message) {
        setFeedbackKind('success');
        setFeedbackMessage(result.value.message);
      }
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to cancel subscription', { error: normalizedError });
      setFeedbackKind('error');
      setFeedbackMessage('Failed to cancel subscription. Please try again.');
    }
    setLoading(false);
  };

  const handleReactivateSubscription = async () => {
    setLoading(true);
    try {
      const result = await reactivateProfileSubscription();
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      await loadProfile();
      if (result.value.message) {
        setFeedbackKind('success');
        setFeedbackMessage(result.value.message);
      }
    } catch (error) {
      logger.error('Failed to reactivate subscription', error);
      setFeedbackKind('error');
      setFeedbackMessage('Failed to reactivate subscription. Please try again.');
    }
    setLoading(false);
  };

  return {
    handleCancelSubscription,
    handleReactivateSubscription,
    handleUpgrade,
  };
};
