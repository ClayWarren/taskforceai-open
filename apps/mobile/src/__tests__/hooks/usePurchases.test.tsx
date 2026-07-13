import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { requirePurchasesModule } from '../../billing/revenuecat';
import { useAuth } from '../../contexts/AuthContext';
import { useSyncMobileSubscriptionMutation } from '../../hooks/api/subscription';
import { usePurchases } from '../../hooks/usePurchases';
import { mobileMetrics } from '../../observability/metrics';

jest.mock('../../billing/revenuecat', () => ({
  requirePurchasesModule: jest.fn(),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../hooks/api/subscription', () => ({
  useSyncMobileSubscriptionMutation: jest.fn(),
}));

jest.mock('../../observability/metrics', () => ({
  mobileMetrics: {
    incrementCounter: jest.fn(),
    startTimer: jest.fn(),
  },
}));

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const makePackage = (identifier: string) => ({
  identifier,
  product: { identifier },
});

const mockRequirePurchasesModule = jest.mocked(requirePurchasesModule);
const mockUseAuth = jest.mocked(useAuth);
const mockUseSyncMobileSubscriptionMutation = jest.mocked(useSyncMobileSubscriptionMutation);

const mockRefreshUser = jest.fn(async () => undefined);
const mockMutateAsync = jest.fn(async () => undefined);
const mockStopTimer = jest.fn();

const mockPurchasesModule = {
  getOfferings: jest.fn(),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
};

describe('usePurchases', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockRequirePurchasesModule.mockReturnValue(mockPurchasesModule as never);
    mockUseAuth.mockReturnValue({ refreshUser: mockRefreshUser } as never);
    mockUseSyncMobileSubscriptionMutation.mockReturnValue(
      { mutateAsync: mockMutateAsync } as never
    );

    mockPurchasesModule.getOfferings.mockResolvedValue({
      current: {
        availablePackages: [makePackage('tfai.pro.monthly'), makePackage('tfai.super.monthly')],
      },
    });
    mockPurchasesModule.purchasePackage.mockResolvedValue(undefined);
    mockPurchasesModule.restorePurchases.mockResolvedValue(undefined);

    (mobileMetrics.startTimer as jest.Mock).mockReturnValue(mockStopTimer);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('handles a successful purchase flow', async () => {
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchasePro();
    });

    expect(mockPurchasesModule.purchasePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        product: expect.objectContaining({ identifier: 'tfai.pro.monthly' }),
      })
    );
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    expect(mockStopTimer).toHaveBeenCalledTimes(1);
    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.initiated', {
      plan: 'pro',
    });
    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.success', {
      plan: 'pro',
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Success',
      'Your TaskForceAI PRO access is active!'
    );
    expect(result.current.isProcessing).toBe(false);
  });

  it('handles cancelled purchases without showing an error alert', async () => {
    mockPurchasesModule.purchasePackage.mockRejectedValueOnce({ userCancelled: true });
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchaseSuper();
    });

    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.cancelled', {
      plan: 'super',
    });
    expect(
      (mobileMetrics.incrementCounter as jest.Mock).mock.calls.map(([name]) => name)
    ).not.toContain('purchase.failure');
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('handles purchase failures and surfaces the error message', async () => {
    mockPurchasesModule.purchasePackage.mockRejectedValueOnce(new Error('card declined'));
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchasePro();
    });

    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.failure', {
      plan: 'pro',
      error: 'card declined',
    });
    expect(Alert.alert).toHaveBeenCalledWith('Purchase Error', 'card declined');
    expect(result.current.isProcessing).toBe(false);
  });

  it('does not fall back to the wrong package when configured product is missing', async () => {
    mockPurchasesModule.getOfferings.mockResolvedValueOnce({
      current: {
        availablePackages: [makePackage('tfai.super.monthly')],
      },
    });
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchasePro();
    });

    expect(mockPurchasesModule.purchasePackage).not.toHaveBeenCalled();
    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.failure', {
      plan: 'pro',
      error: 'The PRO subscription is not available. Please try again later or contact support.',
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Error',
      'The PRO subscription is not available. Please try again later or contact support.'
    );
  });

  it('does not silently purchase the first package when no package matches the plan', async () => {
    mockPurchasesModule.getOfferings.mockResolvedValueOnce({
      current: {
        availablePackages: [makePackage('tfai.enterprise.monthly')],
      },
    });
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchaseSuper();
    });

    expect(mockPurchasesModule.purchasePackage).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Error',
      'The SUPER subscription is not available. Please try again later or contact support.'
    );
  });

  it('shows a support-safe error when offerings contain no packages', async () => {
    mockPurchasesModule.getOfferings.mockResolvedValueOnce({
      current: {
        availablePackages: [],
      },
    });
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.purchasePro();
    });

    expect(mockPurchasesModule.purchasePackage).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Purchase Error',
      'No subscription products are available. Please try again later or contact support.'
    );
  });

  it('blocks re-entry while a purchase is already in progress', async () => {
    const purchaseGate = createDeferred<void>();
    mockPurchasesModule.purchasePackage.mockImplementationOnce(async () => {
      await purchaseGate.promise;
    });

    const { result } = await renderHook(() => usePurchases());

    let firstPurchase!: Promise<void>;
    await act(async () => {
      firstPurchase = result.current.purchasePro();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    await act(async () => {
      await result.current.purchasePro();
    });

    expect(mockPurchasesModule.purchasePackage).toHaveBeenCalledTimes(1);

    purchaseGate.resolve(undefined);
    await act(async () => {
      await firstPurchase;
    });

    expect(result.current.isProcessing).toBe(false);
  });

  it('blocks same-tick purchase re-entry before React rerenders', async () => {
    const purchaseGate = createDeferred<void>();
    mockPurchasesModule.purchasePackage.mockImplementationOnce(async () => {
      await purchaseGate.promise;
    });
    const { result } = await renderHook(() => usePurchases());

    let firstPurchase!: Promise<void>;
    await act(async () => {
      firstPurchase = result.current.purchasePro();
      await result.current.purchasePro();
    });

    expect(mockPurchasesModule.getOfferings).toHaveBeenCalledTimes(1);
    purchaseGate.resolve(undefined);
    await act(async () => {
      await firstPurchase;
    });
  });

  it('restores purchases and re-syncs subscription state', async () => {
    const { result } = await renderHook(() => usePurchases());

    await act(async () => {
      await result.current.restorePurchases();
    });

    expect(mockPurchasesModule.restorePurchases).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockRefreshUser).toHaveBeenCalledTimes(1);
    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.restore.initiated');
    expect(mobileMetrics.incrementCounter).toHaveBeenCalledWith('purchase.restore.success');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Restored',
      'Any active purchases have been restored.'
    );
    expect(result.current.isProcessing).toBe(false);
  });
});
