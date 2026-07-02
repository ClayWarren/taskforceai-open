import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { requirePurchasesModule } from '../billing/revenuecat';
import { billingConfig } from '../config/billing';
import { useAuth } from '../contexts/AuthContext';
import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import { useSyncMobileSubscriptionMutation } from './api/subscription';

const findMatchingPackage = async (plan: 'pro' | 'super'): Promise<PurchasesPackage> => {
  const Purchases = requirePurchasesModule();
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];

  if (packages.length === 0) {
    throw new Error(
      'No subscription products are available. Please try again later or contact support.'
    );
  }

  const targetProductId =
    Platform.OS === 'ios'
      ? plan === 'pro'
        ? billingConfig.appStoreProductIdPro
        : billingConfig.appStoreProductIdSuper
      : plan === 'pro'
        ? billingConfig.playStoreProductIdPro
        : billingConfig.playStoreProductIdSuper;

  if (targetProductId) {
    const match = packages.find(
      (pkg) => pkg.product.identifier === targetProductId || pkg.identifier === targetProductId
    );
    if (match) return match;
    throw new Error(
      `The ${plan.toUpperCase()} subscription is not available. Please try again later or contact support.`
    );
  }

  // Fallback: look for identifier that contains the plan name
  const heuristicMatch = packages.find((pkg) =>
    pkg.identifier.toLowerCase().includes(plan.toLowerCase())
  );
  if (heuristicMatch) return heuristicMatch;

  throw new Error(
    `The ${plan.toUpperCase()} subscription is not available. Please try again later or contact support.`
  );
};

const logger = createModuleLogger('UsePurchases');

export const usePurchases = () => {
  const { refreshUser } = useAuth();
  const syncSubscriptionMutation = useSyncMobileSubscriptionMutation();
  const [isProcessing, setProcessing] = useState(false);

  const syncAndRefresh = useCallback(async () => {
    try {
      await syncSubscriptionMutation.mutateAsync();
      await refreshUser();
    } catch (error: unknown) {
      logger.error('Failed to sync subscription or refresh user', { error });
      throw error; // Re-throw so the caller can handle the failure
    }
  }, [refreshUser, syncSubscriptionMutation]);

  const purchasePlan = useCallback(
    async (plan: 'pro' | 'super') => {
      if (isProcessing) return;

      setProcessing(true);
      mobileMetrics.incrementCounter('purchase.initiated', { plan });
      const stopTimer = mobileMetrics.startTimer('purchase.duration', { plan });
      try {
        const Purchases = requirePurchasesModule();
        const purchasePackage = await findMatchingPackage(plan);
        await Purchases.purchasePackage(purchasePackage);

        // Ensure sync failure prevents the "Success" alert
        await syncAndRefresh();

        stopTimer();
        mobileMetrics.incrementCounter('purchase.success', { plan });
        Alert.alert('Success', `Your TaskForceAI ${plan.toUpperCase()} access is active!`);
      } catch (error: unknown) {
        stopTimer();
        const maybeCancelled =
          error !== null &&
          typeof error === 'object' &&
          (error as Record<string, unknown>)['userCancelled'] === true;

        if (maybeCancelled) {
          mobileMetrics.incrementCounter('purchase.cancelled', { plan });
          return;
        }

        mobileMetrics.incrementCounter('purchase.failure', {
          plan,
          error: error instanceof Error ? error.message : String(error),
        });

        const resolvedMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unable to complete purchase or sync your subscription. Please contact support if you were charged.';

        logger.error('Purchase or sync failed', { error, plan });
        Alert.alert('Purchase Error', resolvedMessage);
      } finally {
        setProcessing(false);
      }
    },
    [isProcessing, syncAndRefresh]
  );

  const restorePurchases = useCallback(async () => {
    if (isProcessing) return;

    setProcessing(true);
    mobileMetrics.incrementCounter('purchase.restore.initiated');
    try {
      const Purchases = requirePurchasesModule();
      await Purchases.restorePurchases();
      await syncAndRefresh();
      mobileMetrics.incrementCounter('purchase.restore.success');
      Alert.alert('Restored', 'Any active purchases have been restored.');
    } catch (error) {
      mobileMetrics.incrementCounter('purchase.restore.failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error('Restore failed', { error });
      Alert.alert(
        'Restore Failed',
        error instanceof Error ? error.message : 'Unable to restore purchases right now.'
      );
    } finally {
      setProcessing(false);
    }
  }, [isProcessing, syncAndRefresh]);

  return {
    purchasePlan,
    purchasePro: () => purchasePlan('pro'),
    purchaseSuper: () => purchasePlan('super'),
    restorePurchases,
    isProcessing,
  };
};
