import type { ProductSummary } from '@taskforceai/contracts/contracts';

import { createSubscription, fetchProducts } from '@taskforceai/contracts/api/subscriptions';
import { type Result, err, ok } from '@taskforceai/shared/result';

export type UpgradePlan = 'pro' | 'super';

export type UpgradeCheckoutError =
  | { kind: 'missing_price'; message: string }
  | { kind: 'products'; message: string }
  | { kind: 'checkout'; message: string }
  | { kind: 'missing_url'; message: string };

interface StartUpgradeParams {
  targetPlan: UpgradePlan;
  priceId?: string | null;
  products?: ProductSummary[];
}

const resolvePriceId = async (
  params: StartUpgradeParams
): Promise<Result<string, UpgradeCheckoutError>> => {
  if (params.priceId) {
    return ok(params.priceId);
  }

  const lookup = (items: ProductSummary[]): string | null => {
    const match = items.find((product) => product.plan === params.targetPlan);
    return match?.price_id ?? null;
  };

  if (params.products) {
    const priceId = lookup(params.products);
    if (!priceId) {
      return err({
        kind: 'missing_price',
        message: 'No upgrade product available',
      });
    }
    return ok(priceId);
  }

  const productsResult = await fetchProducts();
  if (!productsResult.ok) {
    return err({
      kind: 'products',
      message: productsResult.error.message,
    });
  }

  const priceId = lookup(productsResult.value.products);
  if (!priceId) {
    return err({
      kind: 'missing_price',
      message: 'No upgrade product available',
    });
  }

  return ok(priceId);
};

/**
 * Resolves an upgrade checkout URL for a target plan without mutating UI state.
 */
export const startUpgradeCheckout = async (
  params: StartUpgradeParams
): Promise<Result<{ checkoutUrl: string }, UpgradeCheckoutError>> => {
  const priceResult = await resolvePriceId(params);
  if (!priceResult.ok) {
    return priceResult;
  }

  const checkoutResult = await createSubscription(priceResult.value);
  if (!checkoutResult.ok) {
    return err({
      kind: 'checkout',
      message: checkoutResult.error.message,
    });
  }

  const checkoutUrl = checkoutResult.value.checkout_url;
  if (!checkoutUrl) {
    return err({
      kind: 'missing_url',
      message: 'Missing checkout URL',
    });
  }

  return ok({ checkoutUrl });
};
