'use client';

import { useEffect, useRef } from 'react';

import { useRouter, useSearchParams } from '../../components/routing';
import { logger } from '../logger';
import { useAuth } from '../providers/AuthProvider';
import {
  type UpgradePlan,
  startUpgradeCheckout,
} from '@taskforceai/contracts/services/upgrade-flow';

const isUpgradePlan = (plan: string): plan is UpgradePlan => plan === 'pro' || plan === 'super';

/**
 * Hook that detects plan parameter in URL after login and triggers Stripe checkout.
 * Should be placed in a layout that wraps authenticated pages.
 */
export function usePlanCheckout(): void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, sessionStatus } = useAuth();
  const processingRef = useRef(false);

  useEffect(() => {
    const plan = searchParams.get('plan');

    // Only process if authenticated, plan is valid, and not already processing
    if (
      sessionStatus !== 'authenticated' ||
      !isAuthenticated ||
      !plan ||
      !isUpgradePlan(plan) ||
      processingRef.current
    ) {
      return;
    }

    processingRef.current = true;

    const clearPlanParam = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('plan');
      void router.replace(url.pathname + url.search);
    };

    const triggerCheckout = async () => {
      let shouldClearPlanParam = true;
      try {
        logger.info('Triggering upgrade checkout from login redirect', { plan });

        const result = await startUpgradeCheckout({ targetPlan: plan });

        if (result.ok) {
          // Redirect to Stripe checkout
          shouldClearPlanParam = false;
          window.location.assign(result.value.checkoutUrl);
          return;
        } else {
          logger.error('Failed to start checkout', { error: result.error, plan });
        }
      } catch (error: unknown) {
        logger.error('Checkout error', { error, plan });
      } finally {
        processingRef.current = false;
        if (shouldClearPlanParam) {
          clearPlanParam();
        }
      }
    };

    void triggerCheckout();
  }, [searchParams, isAuthenticated, sessionStatus, router]);
}
