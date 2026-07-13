import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { err, ok } from '@taskforceai/client-core/result';

const createSubscriptionMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const fetchProductsMock = vi.fn();
const fetchSubscriptionMock = vi.fn();
const reactivateSubscriptionMock = vi.fn();

mock.module('@taskforceai/api-client/api/subscriptions', () => ({
  cancelSubscription: cancelSubscriptionMock,
  createSubscription: createSubscriptionMock,
  fetchProducts: fetchProductsMock,
  fetchSubscription: fetchSubscriptionMock,
  reactivateSubscription: reactivateSubscriptionMock,
}));

const { startUpgradeCheckout } = (await import(
  `./upgrade-flow?test=${Date.now()}`
)) as typeof import('./upgrade-flow');

const proProduct = {
  id: 'prod_pro',
  name: 'Pro',
  description: null,
  plan: 'pro',
  price_id: 'price_pro',
  price_amount: 2000,
  price_currency: 'usd',
} as const;

describe('upgrade-flow', () => {
  beforeEach(() => {
    createSubscriptionMock.mockReset();
    fetchProductsMock.mockReset();
  });

  it('uses an explicit price id without fetching products', async () => {
    createSubscriptionMock.mockResolvedValue(ok({ checkout_url: 'https://checkout.example/pro' }));

    const result = await startUpgradeCheckout({ targetPlan: 'pro', priceId: 'price_direct' });

    expect(result).toEqual({
      ok: true,
      value: { checkoutUrl: 'https://checkout.example/pro' },
    });
    expect(fetchProductsMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).toHaveBeenCalledWith('price_direct');
  });

  it('resolves a price id from provided products', async () => {
    createSubscriptionMock.mockResolvedValue(ok({ checkout_url: 'https://checkout.example/pro' }));

    const result = await startUpgradeCheckout({ targetPlan: 'pro', products: [proProduct] });

    expect(result.ok).toBe(true);
    expect(createSubscriptionMock).toHaveBeenCalledWith('price_pro');
  });

  it('fetches products when no product list is provided', async () => {
    fetchProductsMock.mockResolvedValue(ok({ products: [proProduct] }));
    createSubscriptionMock.mockResolvedValue(ok({ checkout_url: 'https://checkout.example/pro' }));

    const result = await startUpgradeCheckout({ targetPlan: 'pro' });

    expect(result.ok).toBe(true);
    expect(fetchProductsMock).toHaveBeenCalled();
    expect(createSubscriptionMock).toHaveBeenCalledWith('price_pro');
  });

  it('returns missing_price when the target plan has no price', async () => {
    const result = await startUpgradeCheckout({
      targetPlan: 'super',
      products: [{ ...proProduct, price_id: null }],
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing_price', message: 'No upgrade product available' },
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it('returns products errors without creating a subscription', async () => {
    fetchProductsMock.mockResolvedValue(err({ kind: 'server', message: 'Products unavailable' }));

    const result = await startUpgradeCheckout({ targetPlan: 'pro' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'products', message: 'Products unavailable' },
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it('returns missing_price when fetched products do not contain the target price', async () => {
    fetchProductsMock.mockResolvedValue(ok({ products: [{ ...proProduct, price_id: null }] }));

    const result = await startUpgradeCheckout({ targetPlan: 'pro' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing_price', message: 'No upgrade product available' },
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it('maps checkout failures and missing urls', async () => {
    createSubscriptionMock.mockResolvedValueOnce(err({ kind: 'server', message: 'Checkout down' }));

    await expect(
      startUpgradeCheckout({ targetPlan: 'pro', priceId: 'price_pro' })
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'checkout', message: 'Checkout down' },
    });

    createSubscriptionMock.mockResolvedValueOnce(ok({ checkout_url: '' }));

    await expect(
      startUpgradeCheckout({ targetPlan: 'pro', priceId: 'price_pro' })
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'missing_url', message: 'Missing checkout URL' },
    });
  });
});
