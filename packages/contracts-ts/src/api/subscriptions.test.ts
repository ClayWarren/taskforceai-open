import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const browserClient = {
  cancelSubscription: mock(),
  createSubscription: mock(),
  getProducts: mock(),
  getSubscription: mock(),
  reactivateSubscription: mock(),
};

const getBrowserClientMock = mock(() => browserClient);

mock.module('@taskforceai/contracts/browserClient', () => ({
  getBrowserClient: getBrowserClientMock,
}));

mock.module('../auth/csrf', () => ({
  getCsrfToken: vi.fn(async () => 'csrf-token'),
}));

mock.module('../auth/logger', () => ({
  getAuthLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const {
  cancelSubscription,
  createSubscription,
  fetchProducts,
  fetchSubscription,
  reactivateSubscription,
} = (await import(`./subscriptions?test=${Date.now()}`)) as typeof import('./subscriptions');

describe('subscriptions api helpers', () => {
  beforeEach(() => {
    browserClient.cancelSubscription.mockReset();
    browserClient.createSubscription.mockReset();
    browserClient.getProducts.mockReset();
    browserClient.getSubscription.mockReset();
    browserClient.reactivateSubscription.mockReset();
    getBrowserClientMock.mockClear();
  });

  it('fetches the current subscription through a csrf-enabled browser client', async () => {
    const subscription = {
      subscription: {
        subscription_id: 'sub_123',
        status: 'active',
        current_period_start: 1,
        current_period_end: 2,
        cancel_at_period_end: false,
      },
    };
    browserClient.getSubscription.mockResolvedValue(subscription);

    const result = await fetchSubscription();

    expect(result).toEqual({ ok: true, value: subscription });
    expect(getBrowserClientMock).toHaveBeenCalledWith({ getCsrfToken: expect.any(Function) });
  });

  it('maps product fetch failures', async () => {
    browserClient.getProducts.mockRejectedValue(
      Object.assign(new Error('denied'), { status: 401 })
    );

    const result = await fetchProducts();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'unauthorized',
        message: 'Failed to fetch products',
        status: 401,
      });
    }
  });

  it('creates a subscription for the provided price id', async () => {
    const checkout = { checkout_url: 'https://checkout.example/session' };
    browserClient.createSubscription.mockResolvedValue(checkout);

    const result = await createSubscription('price_123');

    expect(result).toEqual({ ok: true, value: checkout });
    expect(browserClient.createSubscription).toHaveBeenCalledWith('price_123');
  });

  it('unwraps cancel subscription result errors', async () => {
    browserClient.cancelSubscription.mockResolvedValue({
      ok: false,
      error: Object.assign(new Error('cancel failed'), { status: 500 }),
    });

    const result = await cancelSubscription();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'server',
        message: 'Failed to cancel subscription',
        status: 500,
      });
    }
  });

  it('unwraps reactivate subscription success results', async () => {
    browserClient.reactivateSubscription.mockResolvedValue({
      ok: true,
      value: { message: 'Reactivated' },
    });

    await expect(reactivateSubscription()).resolves.toEqual({
      ok: true,
      value: { message: 'Reactivated' },
    });
  });
});
