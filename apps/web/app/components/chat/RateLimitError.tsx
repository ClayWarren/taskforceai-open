'use client';

import React, { useState } from 'react';

import { logger } from '../../lib/logger';
import { navigateTo } from '@taskforceai/browser-runtime/browser-actions';
import { formatRateLimitResetDate } from '@taskforceai/presenters/errors/rate-limit-view';
import { type UpgradePlan, startPlanUpgradeCheckout } from '../../lib/billing/upgrade-checkout';
import { getSignInUrl } from '../../lib/auth/sign-in';
import { useOptionalProfileModal } from '../../lib/profile/modal/ProfileModalContext';
import { useAuth } from '../../lib/providers/AuthProvider';

interface RateLimitErrorProps {
  message: string;
  resetTime?: string;
  onDismiss?: () => void;
}

const RateLimitError: React.FC<RateLimitErrorProps> = ({ message, resetTime, onDismiss }) => {
  const { user } = useAuth();
  const profileModal = useOptionalProfileModal();
  const [processingPlan, setProcessingPlan] = useState<'pro' | 'super' | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const handleUpgrade = (targetPlan: 'pro' | 'super') => {
    if (!user) {
      window.location.assign(getSignInUrl(`/?plan=${targetPlan}`));
      return;
    }

    const startUpgradeFlow = async () => {
      try {
        setProcessingPlan(targetPlan);
        setUpgradeError(null);
        const checkoutResult = await startPlanUpgradeCheckout(targetPlan);
        if (!checkoutResult.ok) {
          throw new Error(checkoutResult.error.message);
        }
        const navigationResult = navigateTo(checkoutResult.value.checkoutUrl);
        if (!navigationResult.ok) {
          throw new Error(navigationResult.error.message);
        }
      } catch (error) {
        logger.error('Failed to start upgrade checkout', { error, targetPlan });
        setUpgradeError(
          'Upgrade link is temporarily unavailable. Please try again from your profile panel.'
        );
        profileModal?.open();
      } finally {
        setProcessingPlan(null);
      }
    };

    void startUpgradeFlow();
  };

  const availableUpgrades =
    user?.plan === 'super' ? [] : user?.plan === 'pro' ? ['super'] : ['pro', 'super'];
  const resetDateLabel = resetTime ? formatRateLimitResetDate(resetTime) : null;

  return (
    <div className="error-message chat-aligned chat-edge-left mb-6 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-orange-50 p-6 shadow-lg dark:border-red-800 dark:from-red-900/20 dark:to-orange-900/20">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1">
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="float-right text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Dismiss error"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
          <h3 className="mb-2 text-lg font-semibold text-red-900 dark:text-red-100">
            Rate Limit Reached
          </h3>
          <p className="mb-4 text-red-800 dark:text-red-200">{message}</p>

          {resetDateLabel && (
            <p className="mb-4 text-sm text-red-700 dark:text-red-300">
              Your limit will reset on: <strong>{resetDateLabel}</strong>
            </p>
          )}

          {availableUpgrades.length > 0 && (
            <div className="mb-4 rounded-lg border border-orange-200 bg-white p-4 dark:border-orange-800 dark:bg-gray-800">
              <h4 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
                Upgrade for more throughput
              </h4>
              <ul className="mb-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <li>✅ Pro · $28/month · 2 messages per hour</li>
                <li>✅ Super · $280/month · 20 messages per hour & highest priority</li>
                <li>✅ Priority support on every paid tier</li>
              </ul>
              <div className="grid gap-3 sm:grid-cols-2">
                {availableUpgrades.map((planOption) => (
                  <button
                    key={planOption}
                    onClick={() => handleUpgrade(planOption as UpgradePlan)}
                    disabled={processingPlan !== null}
                    className="rounded-lg border border-orange-300 bg-gradient-to-r from-orange-500 to-red-500 px-6 py-3 font-semibold text-white shadow-md transition-all duration-200 hover:from-orange-600 hover:to-red-600 hover:shadow-lg disabled:cursor-wait disabled:opacity-70 dark:border-orange-700"
                  >
                    {processingPlan === planOption
                      ? 'Preparing checkout...'
                      : planOption === 'super'
                        ? 'Upgrade to Super ($280/mo)'
                        : 'Upgrade to Pro ($28/mo)'}
                  </button>
                ))}
              </div>
              {upgradeError && (
                <div
                  className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-100"
                  role="alert"
                >
                  {upgradeError}
                </div>
              )}
            </div>
          )}

          {!user && (
            <button
              onClick={() => {
                window.location.assign(getSignInUrl('/'));
              }}
              className="mt-2 text-sm text-blue-400 underline hover:text-blue-300"
            >
              Sign in to TaskForceAI
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RateLimitError;
