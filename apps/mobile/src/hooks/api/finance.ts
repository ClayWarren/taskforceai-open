import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

interface UseFinanceDashboardQueryOptions {
  enabled?: boolean;
}

export const useFinanceDashboardQuery = (options: UseFinanceDashboardQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.finance,
    queryFn: () => client.getFinanceDashboard(),
    enabled,
    staleTime: 60_000,
  });
};

export const useSyncFinanceMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => client.syncFinanceData(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance });
    },
    onError: (error) => {
      mobileLogger.error('[useSyncFinanceMutation] Failed to sync finance data', { error });
    },
  });
};

export const useDisconnectFinanceConnectionMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: number) => client.disconnectFinanceConnection(connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance });
    },
    onError: (error) => {
      mobileLogger.error('[useDisconnectFinanceConnectionMutation] Failed to disconnect finance', {
        error,
      });
    },
  });
};
