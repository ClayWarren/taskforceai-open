import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { err, ok } from '@taskforceai/shared/result';
import {
  cancelProfileSubscription,
  deleteProfileAccount,
  exportProfileData,
  loadProfileData,
  reactivateProfileSubscription,
} from '@taskforceai/contracts/services/profile-service';

const mockDeleteAccount = vi.fn();
const mockExportUserData = vi.fn();

const mockFetchBalance = vi.fn();

vi.mock('@taskforceai/contracts/api/billing', () => ({
  fetchBalance: mockFetchBalance,
}));

vi.mock('@taskforceai/contracts/api/gdpr', () => ({
  deleteAccount: mockDeleteAccount,
  exportUserData: mockExportUserData,
}));

const mockCancelSubscription = vi.fn();
const mockFetchProducts = vi.fn();
const mockFetchSubscription = vi.fn();
const mockReactivateSubscription = vi.fn();

vi.mock('@taskforceai/contracts/api/subscriptions', () => ({
  cancelSubscription: mockCancelSubscription,
  fetchProducts: mockFetchProducts,
  fetchSubscription: mockFetchSubscription,
  reactivateSubscription: mockReactivateSubscription,
}));

describe('profile-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBalance.mockResolvedValue(ok({ creditBalance: 12.5 } as any));
  });

  describe('loadProfileData', () => {
    it('loads subscription and products', async () => {
      const subscription = { id: 'sub_1' };
      const products = [{ id: 'prod_1' }];
      mockFetchSubscription.mockResolvedValue(ok({ subscription, products: [] } as any));
      mockFetchProducts.mockResolvedValue(ok({ products } as any));

      const result = await loadProfileData();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.balance).toEqual({ creditBalance: 12.5 } as any);
        expect(result.value.subscription).toEqual(subscription as any);
        expect(result.value.products).toEqual(products as any);
      }
    });

    it('loads profile data when balance fetch fails', async () => {
      mockFetchSubscription.mockResolvedValue(ok({ subscription: null, products: [] } as any));
      mockFetchProducts.mockResolvedValue(ok({ products: [] } as any));
      mockFetchBalance.mockResolvedValue(err({ kind: 'server', message: 'BalanceFail' } as any));

      const result = await loadProfileData();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.balance).toBeNull();
      }
    });

    it('returns error if subscription fetch fails', async () => {
      mockFetchSubscription.mockResolvedValue(err({ kind: 'server', message: 'Fail' } as any));
      mockFetchProducts.mockResolvedValue(ok({ products: [] } as any));

      const result = await loadProfileData();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('subscription');
      }
    });
    it('returns error if products fetch fails', async () => {
      mockFetchSubscription.mockResolvedValue(ok({ subscription: { id: 's1' } } as any));
      mockFetchProducts.mockResolvedValue(err({ kind: 'server', message: 'ProdFail' } as any));

      const result = await loadProfileData();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('products');
        expect(result.error.message).toBe('ProdFail');
      }
    });
  });

  describe('exportProfileData', () => {
    it('exports data and builds filename', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' });
      mockExportUserData.mockResolvedValue(ok(blob));

      const result = await exportProfileData('testuser');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blob).toBe(blob);
        expect(result.value.filename).toContain('taskforceai-data-export-testuser');
      }
    });

    it('uses default filename if username is missing', async () => {
      const blob = new Blob(['{}'], { type: 'application/json' });
      mockExportUserData.mockResolvedValue(ok(blob));

      const result = await exportProfileData(null);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.filename).toContain('taskforceai-data-export-user-');
      }
    });

    it('returns error if export fails', async () => {
      mockExportUserData.mockResolvedValue(err({ kind: 'server', message: 'ExportFail' }));

      const result = await exportProfileData();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('export');
        expect(result.error.message).toBe('ExportFail');
      }
    });
  });

  describe('deleteProfileAccount', () => {
    it('returns error if delete fails', async () => {
      mockDeleteAccount.mockResolvedValue(err({ kind: 'server', message: 'DeleteFail' }));
      const result = await deleteProfileAccount('testuser');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('delete');
        expect(result.error.message).toBe('DeleteFail');
      }
    });

    it('calls deleteAccount API', async () => {
      mockDeleteAccount.mockResolvedValue(ok({ message: 'Deleted' }));
      const result = await deleteProfileAccount('testuser');
      expect(result.ok).toBe(true);
    });
  });

  describe('subscription actions', () => {
    it('cancels subscription', async () => {
      mockCancelSubscription.mockResolvedValue(ok({ message: 'Cancelled' }));
      const result = await cancelProfileSubscription();
      expect(result.ok).toBe(true);
    });

    it('reactivates subscription', async () => {
      mockReactivateSubscription.mockResolvedValue(ok({ message: 'Reactivated' }));
      const result = await reactivateProfileSubscription();
      expect(result.ok).toBe(true);
    });
  });
});
