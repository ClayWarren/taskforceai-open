import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import { err, ok } from '@taskforceai/shared/result';

const browserClient = {
  disconnectIntegration: mock(),
  getIntegrations: mock(),
};

mock.module('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: mock(() => browserClient),
}));

const fetchBalanceMock = vi.fn();
const deleteAccountMock = vi.fn();
const exportUserDataMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const fetchProductsMock = vi.fn();
const fetchSubscriptionMock = vi.fn();
const reactivateSubscriptionMock = vi.fn();

mock.module('@taskforceai/contracts/api/billing', () => ({
  fetchBalance: fetchBalanceMock,
}));

mock.module('@taskforceai/contracts/api/gdpr', () => ({
  deleteAccount: deleteAccountMock,
  exportUserData: exportUserDataMock,
}));

mock.module('@taskforceai/contracts/api/subscriptions', () => ({
  cancelSubscription: cancelSubscriptionMock,
  fetchProducts: fetchProductsMock,
  fetchSubscription: fetchSubscriptionMock,
  reactivateSubscription: reactivateSubscriptionMock,
}));

const {
  cancelProfileSubscription,
  deleteProfileAccount,
  disconnectProfileIntegration,
  exportProfileData,
  loadIntegrations,
  loadProfileData,
  reactivateProfileSubscription,
} = (await import(`./profile-service?test=${Date.now()}`)) as typeof import('./profile-service');

describe('profile service', () => {
  beforeEach(() => {
    browserClient.disconnectIntegration.mockReset();
    browserClient.getIntegrations.mockReset();
    fetchBalanceMock.mockReset();
    deleteAccountMock.mockReset();
    exportUserDataMock.mockReset();
    cancelSubscriptionMock.mockReset();
    fetchProductsMock.mockReset();
    fetchSubscriptionMock.mockReset();
    reactivateSubscriptionMock.mockReset();

    fetchBalanceMock.mockResolvedValue(
      ok({
        creditBalance: 12,
        autoRechargeEnabled: false,
        autoRechargeAmount: null,
        autoRechargeThreshold: null,
        subscriptionStatus: null,
        subscriptionId: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        currentPeriodStart: null,
      })
    );
  });

  it('loads subscription products and balance', async () => {
    const subscription = {
      subscription_id: 'sub_123',
      status: 'active',
      current_period_start: 1,
      current_period_end: 2,
      cancel_at_period_end: false,
    };
    const products = [{ id: 'prod_1', plan: 'pro' }];
    fetchSubscriptionMock.mockResolvedValue(ok({ subscription }));
    fetchProductsMock.mockResolvedValue(ok({ products }));

    const result = await loadProfileData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subscription).toBe(subscription as never);
      expect(result.value.products).toBe(products as never);
      expect(result.value.balance?.creditBalance).toBe(12);
    }
  });

  it('treats balance failures as non-fatal profile data', async () => {
    fetchSubscriptionMock.mockResolvedValue(ok({ subscription: null }));
    fetchProductsMock.mockResolvedValue(ok({ products: [] }));
    fetchBalanceMock.mockResolvedValue(err({ kind: 'server', message: 'Balance failed' }));

    const result = await loadProfileData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.balance).toBeNull();
    }
  });

  it('returns subscription and product load failures', async () => {
    fetchSubscriptionMock.mockResolvedValueOnce(err({ kind: 'server', message: 'Sub failed' }));
    fetchProductsMock.mockResolvedValueOnce(ok({ products: [] }));

    await expect(loadProfileData()).resolves.toEqual({
      ok: false,
      error: { kind: 'subscription', message: 'Sub failed' },
    });

    fetchSubscriptionMock.mockResolvedValueOnce(ok({ subscription: null }));
    fetchProductsMock.mockResolvedValueOnce(err({ kind: 'server', message: 'Products failed' }));

    await expect(loadProfileData()).resolves.toEqual({
      ok: false,
      error: { kind: 'products', message: 'Products failed' },
    });
  });

  it('exports profile data with a dated filename', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' });
    exportUserDataMock.mockResolvedValue(ok(blob));

    const result = await exportProfileData('test-user');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blob).toBe(blob);
      expect(result.value.filename).toMatch(
        /^taskforceai-data-export-test-user-\d{4}-\d{2}-\d{2}\.json$/
      );
    }
  });

  it('maps profile export and delete failures', async () => {
    exportUserDataMock.mockResolvedValue(err({ message: 'Export failed' }));
    await expect(exportProfileData()).resolves.toEqual({
      ok: false,
      error: { kind: 'export', message: 'Export failed' },
    });

    deleteAccountMock.mockResolvedValue(err({ message: 'Delete failed' }));
    await expect(deleteProfileAccount('test@example.com')).resolves.toEqual({
      ok: false,
      error: { kind: 'delete', message: 'Delete failed' },
    });
  });

  it('delegates subscription actions', async () => {
    cancelSubscriptionMock.mockResolvedValue(ok({ message: 'Cancelled' }));
    reactivateSubscriptionMock.mockResolvedValue(ok({ message: 'Reactivated' }));

    await expect(cancelProfileSubscription()).resolves.toEqual({
      ok: true,
      value: { message: 'Cancelled' },
    });
    await expect(reactivateProfileSubscription()).resolves.toEqual({
      ok: true,
      value: { message: 'Reactivated' },
    });
  });

  it('loads and disconnects integrations through the browser client', async () => {
    const integrations = [{ provider: 'github', connected: true }];
    browserClient.getIntegrations.mockResolvedValue(integrations);
    browserClient.disconnectIntegration.mockResolvedValue(undefined);

    await expect(loadIntegrations()).resolves.toEqual({ ok: true, value: integrations });
    await expect(disconnectProfileIntegration('github')).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(browserClient.disconnectIntegration).toHaveBeenCalledWith('github');
  });

  it('returns integration errors as Error instances', async () => {
    browserClient.getIntegrations.mockRejectedValue('offline');
    browserClient.disconnectIntegration.mockRejectedValue(new Error('denied'));

    const loadResult = await loadIntegrations();
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error).toEqual(new Error('offline'));
    }

    const disconnectResult = await disconnectProfileIntegration('github');
    expect(disconnectResult.ok).toBe(false);
    if (!disconnectResult.ok) {
      expect(disconnectResult.error).toEqual(new Error('denied'));
    }
  });
});
