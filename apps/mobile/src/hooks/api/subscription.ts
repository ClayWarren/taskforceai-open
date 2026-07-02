import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

interface UseSubscriptionQueryOptions {
  enabled?: boolean;
}

export const useSubscriptionQuery = (options: UseSubscriptionQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: () => client.getSubscription(),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
};

export const useBillingBalanceQuery = (options: UseSubscriptionQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.billingBalance,
    queryFn: () => client.getBalance(),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
};

interface UseProductsQueryOptions {
  enabled?: boolean;
}

export const useProductsQuery = (options: UseProductsQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.products,
    queryFn: () => client.getProducts(),
    enabled,
    staleTime: 10 * 60_000,
  });
};

export const useSyncMobileSubscriptionMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await client.syncMobileSubscription();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscription });
      void queryClient.invalidateQueries({ queryKey: queryKeys.user });
    },
    onError: (error) => {
      mobileLogger.error('[useSyncMobileSubscriptionMutation] Failed to sync subscription', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};
