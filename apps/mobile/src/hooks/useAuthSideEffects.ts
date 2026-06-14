import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { useEffect } from 'react';

import { createModuleLogger } from '../logger';
import { configureRevenueCat } from '../billing/revenuecat';

const logger = createModuleLogger('useAuthSideEffects');

const REVENUECAT_BLOCKED_APP_USER_IDS = new Set([
  '0',
  '-1',
  '[]',
  '{}',
  '(null)',
  '[object object]',
  'anonymous',
  'guest',
  'nan',
  'nil',
  'no_user',
  'none',
  'null',
  'undefined',
  'unidentified',
]);

const isValidRevenueCatAppUserId = (value: string | null | undefined): value is string => {
  const normalized = value?.trim();
  if (!normalized) return false;
  if (normalized.includes('/')) return false;
  return !REVENUECAT_BLOCKED_APP_USER_IDS.has(normalized.toLowerCase());
};

export const resolveRevenueCatAppUserId = (
  user: Pick<AuthenticatedUser, 'email' | 'id'> | null
): string | null => {
  if (!user) return null;

  const email = user.email?.trim().toLowerCase();
  if (isValidRevenueCatAppUserId(email)) return email;

  const id = user.id == null ? null : String(user.id);
  return isValidRevenueCatAppUserId(id) ? id.trim() : null;
};

/**
 * Custom hook to handle auth side effects like configuring RevenueCat.
 */

export const useAuthSideEffects = (user: AuthenticatedUser | null) => {
  useEffect(() => {
    const initBilling = async () => {
      try {
        await configureRevenueCat(resolveRevenueCatAppUserId(user));
      } catch (error) {
        logger.error('Failed to auto-configure RevenueCat', { error });
      }
    };
    void initBilling();
  }, [user?.email, user?.id]);
};
