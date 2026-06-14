import { useQuery } from '@tanstack/react-query';
import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';

import { getMobileClient } from '../../api/client';
import { queryKeys } from './queryKeys';

const STALE_TIME_MS = 5 * 60 * 1000;

interface UseModelSelectorQueryOptions {
  enabled?: boolean;
}

export const useModelSelectorQuery = (options: UseModelSelectorQueryOptions = {}) => {
  const { enabled = true } = options;

  return useQuery<ModelSelectorResponse>({
    queryKey: queryKeys.modelSelector,
    queryFn: async () => {
      const client = getMobileClient();
      return client.getModelOptions();
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
};
