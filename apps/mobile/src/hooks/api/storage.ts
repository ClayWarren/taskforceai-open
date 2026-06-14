import { useQuery } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { queryKeys } from './queryKeys';

interface UseStorageSummaryQueryOptions {
  enabled?: boolean;
}

export const useStorageSummaryQuery = (options: UseStorageSummaryQueryOptions = {}) => {
  const client = getMobileClient();
  const { enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.storage,
    queryFn: () => client.getStorageSummary(),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
};
