import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
  fetchBalance,
  fetchPaymentMethods,
  fetchInvoices,
  updateAutoRecharge,
  createPortalSession,
} from '@taskforceai/api-client/api/billing';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';

vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient: vi.fn(),
}));

describe('billing api', () => {
  const mockClient = {
    getBalance: vi.fn(),
    getPaymentMethods: vi.fn(),
    getInvoices: vi.fn(),
    updateAutoRecharge: vi.fn(),
    createPortalSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const getBrowserClientMock = getBrowserClient as any;
    getBrowserClientMock.mockReset();
    getBrowserClientMock.mockReturnValue(mockClient);
  });

  describe('fetchBalance', () => {
    it('returns balance on success', async () => {
      const mockBalance = {
        creditBalance: 10.5,
        autoRechargeEnabled: true,
        autoRechargeAmount: 20,
        autoRechargeThreshold: 5,
        subscriptionStatus: 'active',
        subscriptionId: 'sub_123',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: 1735689600,
        currentPeriodStart: 1733107200,
      };
      mockClient.getBalance.mockResolvedValue(mockBalance);

      const result = await fetchBalance();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.creditBalance).toBe(10.5);
        expect(result.value.autoRechargeEnabled).toBe(true);
      }
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.getBalance.mockRejectedValue({ status: 401 });
      const result = await fetchBalance();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });

    it('returns server error on 500', async () => {
      mockClient.getBalance.mockRejectedValue({ status: 500 });
      const result = await fetchBalance();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('server');
      }
    });

    it('returns network error on generic failure', async () => {
      mockClient.getBalance.mockRejectedValue(new Error('Network fail'));
      const result = await fetchBalance();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('network');
      }
    });
  });

  describe('fetchPaymentMethods', () => {
    it('returns payment methods on success', async () => {
      const mockMethods = [
        {
          id: 'pm_123',
          brand: 'visa',
          last4: '4242',
          expMonth: 12,
          expYear: 2026,
          isDefault: true,
        },
      ];
      mockClient.getPaymentMethods.mockResolvedValue(mockMethods);

      const result = await fetchPaymentMethods();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.brand).toBe('visa');
      }
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.getPaymentMethods.mockRejectedValue({ status: 401 });
      const result = await fetchPaymentMethods();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });
  });

  describe('fetchInvoices', () => {
    it('returns invoices on success', async () => {
      const mockInvoices = [
        {
          id: 'in_123',
          number: 'INV-001',
          amountPaid: 10.0,
          currency: 'usd',
          status: 'paid',
          createdAt: 1735689600,
          invoicePdf: 'https://stripe.com/pdf',
          hostedUrl: 'https://stripe.com/invoice',
        },
      ];
      mockClient.getInvoices.mockResolvedValue(mockInvoices);

      const result = await fetchInvoices();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.amountPaid).toBe(10.0);
      }
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.getInvoices.mockRejectedValue({ status: 401 });
      const result = await fetchInvoices();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });
  });

  describe('updateAutoRecharge', () => {
    it('returns balance on success', async () => {
      const mockBalance = {
        creditBalance: 10.5,
        autoRechargeEnabled: true,
        autoRechargeAmount: 20,
        autoRechargeThreshold: 5,
        subscriptionStatus: null,
        subscriptionId: null,
        cancelAtPeriodEnd: false,
      };
      mockClient.updateAutoRecharge.mockResolvedValue({ ok: true, value: mockBalance });

      const result = await updateAutoRecharge({ enabled: true, amount: 20, threshold: 5 });
      expect(result.ok).toBe(true);
      expect(getBrowserClient).toHaveBeenCalledWith({ getCsrfToken });
      if (result.ok) {
        expect(result.value.autoRechargeEnabled).toBe(true);
      }
    });

    it('returns error when result.ok is false', async () => {
      mockClient.updateAutoRecharge.mockResolvedValue({ ok: false, error: { status: 400 } });
      const result = await updateAutoRecharge({ enabled: true, amount: 20, threshold: 5 });
      expect(result.ok).toBe(false);
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.updateAutoRecharge.mockResolvedValue({
        ok: false,
        error: { status: 401 },
      });
      const result = await updateAutoRecharge({ enabled: false, amount: null, threshold: null });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });
  });

  describe('createPortalSession', () => {
    it('returns portal url on success', async () => {
      mockClient.createPortalSession.mockResolvedValue({
        ok: true,
        value: { url: 'https://billing.stripe.com/portal' },
      });

      const result = await createPortalSession();
      expect(result.ok).toBe(true);
      expect(getBrowserClient).toHaveBeenCalledWith({ getCsrfToken });
      if (result.ok) {
        expect(result.value.url).toBe('https://billing.stripe.com/portal');
      }
    });

    it('returns error when result.ok is false', async () => {
      mockClient.createPortalSession.mockResolvedValue({ ok: false, error: { status: 400 } });
      const result = await createPortalSession();
      expect(result.ok).toBe(false);
    });

    it('returns unauthorized error on 401', async () => {
      mockClient.createPortalSession.mockResolvedValue({
        ok: false,
        error: { status: 401 },
      });
      const result = await createPortalSession();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unauthorized');
      }
    });
  });
});
