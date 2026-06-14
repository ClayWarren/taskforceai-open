import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

const browserClient = {
  createPortalSession: mock(),
  getBalance: mock(),
  getInvoices: mock(),
  getPaymentMethods: mock(),
  updateAutoRecharge: mock(),
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
  createPortalSession,
  fetchBalance,
  fetchInvoices,
  fetchPaymentMethods,
  updateAutoRecharge,
} = (await import(`./billing?test=${Date.now()}`)) as typeof import('./billing');

describe('billing api helpers', () => {
  beforeEach(() => {
    browserClient.createPortalSession.mockReset();
    browserClient.getBalance.mockReset();
    browserClient.getInvoices.mockReset();
    browserClient.getPaymentMethods.mockReset();
    browserClient.updateAutoRecharge.mockReset();
    getBrowserClientMock.mockClear();
  });

  it('returns balance data from the browser client', async () => {
    const balance = {
      creditBalance: 25,
      autoRechargeEnabled: false,
      autoRechargeAmount: null,
      autoRechargeThreshold: null,
      subscriptionStatus: 'active',
      subscriptionId: 'sub_123',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      currentPeriodStart: null,
    };
    browserClient.getBalance.mockResolvedValue(balance);

    const result = await fetchBalance();

    expect(result).toEqual({ ok: true, value: balance });
  });

  it('maps thrown client failures to billing errors', async () => {
    browserClient.getInvoices.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }));

    const result = await fetchInvoices();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'unauthorized',
        message: 'Failed to fetch invoices',
        status: 401,
      });
    }
  });

  it('fetches payment methods', async () => {
    const methods = [
      {
        id: 'pm_1',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
      },
    ];
    browserClient.getPaymentMethods.mockResolvedValue(methods);

    await expect(fetchPaymentMethods()).resolves.toEqual({ ok: true, value: methods });
  });

  it('uses csrf-enabled client options for state-changing billing calls', async () => {
    const balance = {
      creditBalance: 10,
      autoRechargeEnabled: true,
      autoRechargeAmount: 20,
      autoRechargeThreshold: 5,
      subscriptionStatus: null,
      subscriptionId: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      currentPeriodStart: null,
    };
    const request = { enabled: true, amount: 20, threshold: 5 };
    browserClient.updateAutoRecharge.mockResolvedValue({ ok: true, value: balance });

    const result = await updateAutoRecharge(request);

    expect(result).toEqual({ ok: true, value: balance });
    expect(browserClient.updateAutoRecharge).toHaveBeenCalledWith(request);
    expect(getBrowserClientMock).toHaveBeenCalledWith({ getCsrfToken: expect.any(Function) });
  });

  it('unwraps portal result errors before mapping them', async () => {
    browserClient.createPortalSession.mockResolvedValue({
      ok: false,
      error: Object.assign(new Error('portal unavailable'), { status: 503 }),
    });

    const result = await createPortalSession();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: 'server',
        message: 'Failed to create portal session',
        status: 503,
      });
    }
  });
});
