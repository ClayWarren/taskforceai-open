import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import type {
  BalanceResponse,
  ProductSummary,
  SubscriptionSummary,
} from '@taskforceai/contracts/contracts';

import { fetchBalance } from '@taskforceai/contracts/api/billing';
import { deleteAccount, exportUserData } from '@taskforceai/contracts/api/gdpr';
import {
  cancelSubscription,
  fetchProducts,
  fetchSubscription,
  reactivateSubscription,
} from '@taskforceai/contracts/api/subscriptions';
import { type Result, err, ok } from '@taskforceai/shared/result';

export type ProfileLoadError = {
  kind: 'subscription' | 'products';
  message: string;
};

export type ExportDataError = {
  kind: 'export';
  message: string;
};

export type DeleteAccountError = {
  kind: 'delete';
  message: string;
};

export type ProfileData = {
  balance: BalanceResponse | null;
  subscription: SubscriptionSummary | null;
  products: ProductSummary[];
};

export const loadProfileData = async (): Promise<Result<ProfileData, ProfileLoadError>> => {
  const [subscriptionResult, productsResult, balanceResult] = await Promise.all([
    fetchSubscription(),
    fetchProducts(),
    fetchBalance(),
  ]);

  if (!subscriptionResult.ok) {
    return err({ kind: 'subscription', message: subscriptionResult.error.message });
  }

  if (!productsResult.ok) {
    return err({ kind: 'products', message: productsResult.error.message });
  }

  return ok({
    balance: balanceResult.ok ? balanceResult.value : null,
    subscription: subscriptionResult.value.subscription,
    products: productsResult.value.products,
  });
};

export const exportProfileData = async (
  username?: string | null
): Promise<Result<{ blob: Blob; filename: string }, ExportDataError>> => {
  const exportResult = await exportUserData();
  if (!exportResult.ok) {
    return err({ kind: 'export', message: exportResult.error.message });
  }

  const safeName = username ?? 'user';
  const dateLabel = new Date().toISOString().split('T')[0];
  return ok({
    blob: exportResult.value,
    filename: `taskforceai-data-export-${safeName}-${dateLabel}.json`,
  });
};

export const deleteProfileAccount = async (
  confirmEmail: string
): Promise<Result<{ message: string }, DeleteAccountError>> => {
  const result = await deleteAccount(confirmEmail);
  if (!result.ok) {
    return err({ kind: 'delete', message: result.error.message });
  }
  return ok(result.value);
};

export const cancelProfileSubscription = () => cancelSubscription();

export const reactivateProfileSubscription = () => reactivateSubscription();

export const loadIntegrations = async (): Promise<
  Result<Array<{ provider: string; connected: boolean }>>
> => {
  try {
    const client = getBrowserClient();
    const data = await client.getIntegrations();
    return ok(data);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};

export const disconnectProfileIntegration = async (provider: string): Promise<Result<true>> => {
  try {
    const client = getBrowserClient();
    await client.disconnectIntegration(provider);
    return ok(true);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
