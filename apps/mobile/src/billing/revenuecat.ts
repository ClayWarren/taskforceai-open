import { Platform } from 'react-native';

import { getMobileClient } from '../api/client';
import { billingConfig } from '../config/billing';
import { queryKeys } from '../hooks/api/queryKeys';
import { queryClient } from '../providers/queryClient';
import { createModuleLogger } from '../logger';

type PurchasesModule = typeof import('react-native-purchases').default;

const PURCHASES_UNAVAILABLE_MESSAGE =
  'In-app purchases are unavailable in Expo Go. Create a development build (https://docs.expo.dev/development/introduction/) to test billing flows.';

let cachedPurchases: PurchasesModule | null | undefined;
const logger = createModuleLogger('RevenueCat');

const loadPurchasesModule = (): PurchasesModule | null => {
  if (cachedPurchases !== undefined) {
    return cachedPurchases;
  }
  try {
    const module = require('react-native-purchases') as { default?: PurchasesModule };
    cachedPurchases = module.default;
  } catch (error) {
    logger.warn(
      'react-native-purchases native module is unavailable. Use a development build instead of Expo Go to enable subscriptions.',
      { error }
    );
    cachedPurchases = null;
  }
  return cachedPurchases ?? null;
};

export const requirePurchasesModule = (): PurchasesModule => {
  const purchasesModule = loadPurchasesModule();
  if (!purchasesModule) {
    throw new Error(PURCHASES_UNAVAILABLE_MESSAGE);
  }
  if (!isConfigured) {
    const apiKey = getPlatformApiKey();
    if (!apiKey) {
      throw new Error(
        'RevenueCat API key is missing. Ensure REVENUECAT_IOS_API_KEY or REVENUECAT_ANDROID_API_KEY is set in your .env file.'
      );
    }
    logger.info('Auto-configuring RevenueCat before use');
    purchasesModule.configure({ apiKey });
    isConfigured = true;
  }
  ensureCustomerInfoListener(purchasesModule);
  return purchasesModule;
};

let isConfigured = false;
let currentAppUserId: string | null = null;
let listenerAttached = false;

const ensureCustomerInfoListener = (Purchases: PurchasesModule): void => {
  if (listenerAttached) {
    return;
  }
  Purchases.addCustomerInfoUpdateListener(() => {
    void syncSubscriptionWithBackend();
  });
  listenerAttached = true;
};

const getPlatformApiKey = () =>
  Platform.OS === 'ios' ? billingConfig.revenueCatIosApiKey : billingConfig.revenueCatAndroidApiKey;

export async function configureRevenueCat(appUserId?: string | null): Promise<void> {
  const apiKey = getPlatformApiKey();
  if (!apiKey) {
    logger.warn('RevenueCat API key missing; skipping configuration. Subscriptions will not work.');
    return;
  }

  const Purchases = loadPurchasesModule();
  if (!Purchases) {
    logger.warn('Purchases module unavailable; skipping configuration.');
    return;
  }

  if (!isConfigured) {
    try {
      Purchases.configure({
        apiKey,
        appUserID: appUserId ?? null,
      });
      isConfigured = true;
      currentAppUserId = appUserId ?? null;
      logger.info('RevenueCat configured', { appUserId });

      ensureCustomerInfoListener(Purchases);
    } catch (error) {
      logger.error('Failed to configure RevenueCat', { error });
    }
    return;
  }

  ensureCustomerInfoListener(Purchases);

  // Already configured, check if we need to switch users
  if (appUserId && appUserId !== currentAppUserId) {
    try {
      logger.info('RevenueCat switching user', { from: currentAppUserId, to: appUserId });
      await Purchases.logIn(appUserId);
      currentAppUserId = appUserId;
    } catch (error) {
      logger.error('Failed to log in to RevenueCat during configuration', { error });
    }
    return;
  }

  if (!appUserId && currentAppUserId) {
    try {
      logger.info('RevenueCat logging out user', { userId: currentAppUserId });
      await Purchases.logOut();
      currentAppUserId = null;
    } catch (error) {
      logger.error('Failed to log out of RevenueCat during configuration', { error });
    }
  }
}

async function syncSubscriptionWithBackend(): Promise<void> {
  try {
    const client = getMobileClient();
    await client.syncMobileSubscription();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subscription }),
      queryClient.invalidateQueries({ queryKey: queryKeys.user }),
    ]);
  } catch (error) {
    logger.error('Failed to sync subscription with backend', { error });
  }
}
