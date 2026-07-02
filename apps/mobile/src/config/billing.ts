import Constants from 'expo-constants';

export interface BillingConfig {
  revenueCatIosApiKey: string;
  revenueCatAndroidApiKey: string;
  entitlementPro: string;
  entitlementSuper: string;
  appStoreProductIdPro: string;
  appStoreProductIdSuper: string;
  playStoreProductIdPro: string;
  playStoreProductIdSuper: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getProperty(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  return obj[key];
}

const getExtra = (): Partial<BillingConfig> => {
  const constantsRecord: UnknownRecord = Constants;
  const expoConfig = Constants.expoConfig ?? getProperty(constantsRecord, 'manifest');

  const extra = getProperty(expoConfig, 'extra');
  const billing = getProperty(extra, 'billing');

  if (!isRecord(billing)) {
    return {};
  }

  return billing;
};

export const billingConfig: BillingConfig = {
  revenueCatIosApiKey: String(getExtra().revenueCatIosApiKey ?? ''),
  revenueCatAndroidApiKey: String(getExtra().revenueCatAndroidApiKey ?? ''),
  entitlementPro: String(getExtra().entitlementPro ?? 'pro'),
  entitlementSuper: String(getExtra().entitlementSuper ?? 'super'),
  appStoreProductIdPro: String(getExtra().appStoreProductIdPro ?? 'tfai.pro.monthly'),
  appStoreProductIdSuper: String(getExtra().appStoreProductIdSuper ?? 'tfai.super.monthly'),
  playStoreProductIdPro: String(getExtra().playStoreProductIdPro ?? 'tfai_pro_monthly'),
  playStoreProductIdSuper: String(getExtra().playStoreProductIdSuper ?? 'tfai_super_monthly'),
};
