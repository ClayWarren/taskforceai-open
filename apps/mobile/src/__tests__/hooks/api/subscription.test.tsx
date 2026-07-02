import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';

import {
  useBillingBalanceQuery,
  useSubscriptionQuery,
  useProductsQuery,
  useSyncMobileSubscriptionMutation,
} from '../../../hooks/api/subscription';
import { renderHookWithQueryClient } from '../../helpers/query-client';

const mockClient = {
  getBalance: jest.fn().mockResolvedValue({ creditBalance: 10 }),
  getSubscription: jest.fn().mockResolvedValue({ status: 'free' }),
  getProducts: jest.fn().mockResolvedValue([]),
  syncMobileSubscription: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../api/client', () => ({
  getMobileClient: () => mockClient,
}));

jest.mock('../../../logger', () => ({
  createModuleLogger: () => ({ error: jest.fn() }),
  mobileLogger: { error: jest.fn() },
}));

describe('useSubscriptionQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getSubscription', async () => {
    mockClient.getSubscription.mockResolvedValueOnce({ status: 'free' });
    renderHookWithQueryClient(() => useSubscriptionQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getSubscription).toHaveBeenCalledTimes(1);
  });

  it('returns subscription data', async () => {
    const mockData = { status: 'pro', expiresAt: '2024-12-31' };
    mockClient.getSubscription.mockResolvedValueOnce(mockData);
    const { result } = renderHookWithQueryClient(() => useSubscriptionQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(result.current.data).toEqual(mockData);
  });

  it('is disabled when enabled option is false', async () => {
    mockClient.getSubscription.mockClear();
    renderHookWithQueryClient(() => useSubscriptionQuery({ enabled: false }));

    expect(mockClient.getSubscription).not.toHaveBeenCalled();
  });

  it('uses correct query key', async () => {
    mockClient.getSubscription.mockResolvedValueOnce({ status: 'free' });
    const { queryClient } = renderHookWithQueryClient(() => useSubscriptionQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    const cachedData = queryClient.getQueryData(['subscription']);
    expect(cachedData).toBeDefined();
  });
});

describe('useProductsQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getProducts', async () => {
    mockClient.getProducts.mockResolvedValueOnce([]);
    renderHookWithQueryClient(() => useProductsQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getProducts).toHaveBeenCalledTimes(1);
  });

  it('returns products data', async () => {
    const mockProducts = [{ id: 'pro-monthly', price: 9.99 }];
    mockClient.getProducts.mockResolvedValueOnce(mockProducts);
    const { result } = renderHookWithQueryClient(() => useProductsQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(result.current.data).toEqual(mockProducts);
  });

  it('is disabled when enabled option is false', async () => {
    mockClient.getProducts.mockClear();
    renderHookWithQueryClient(() => useProductsQuery({ enabled: false }));

    expect(mockClient.getProducts).not.toHaveBeenCalled();
  });

  it('uses correct query key', async () => {
    mockClient.getProducts.mockResolvedValueOnce([]);
    const { queryClient } = renderHookWithQueryClient(() => useProductsQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    const cachedData = queryClient.getQueryData(['products']);
    expect(cachedData).toBeDefined();
  });
});

describe('useBillingBalanceQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getBalance', async () => {
    mockClient.getBalance.mockResolvedValueOnce({ creditBalance: 10 });
    renderHookWithQueryClient(() => useBillingBalanceQuery());

    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(mockClient.getBalance).toHaveBeenCalledTimes(1);
  });

  it('is disabled when enabled option is false', () => {
    mockClient.getBalance.mockClear();
    renderHookWithQueryClient(() => useBillingBalanceQuery({ enabled: false }));

    expect(mockClient.getBalance).not.toHaveBeenCalled();
  });
});

describe('useSyncMobileSubscriptionMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls syncMobileSubscription', async () => {
    const { result } = renderHookWithQueryClient(() => useSyncMobileSubscriptionMutation());

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockClient.syncMobileSubscription).toHaveBeenCalledTimes(1);
  });

  it('invalidates subscription and user queries on success', async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSyncMobileSubscriptionMutation());
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscription'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['user'] });
  });

  it('handles errors', async () => {
    mockClient.syncMobileSubscription.mockRejectedValueOnce(new Error('Sync failed'));
    const { result } = renderHookWithQueryClient(() => useSyncMobileSubscriptionMutation());

    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch {
        // Expected
      }
    });

    expect(result.current.isError).toBe(true);
  });
});
