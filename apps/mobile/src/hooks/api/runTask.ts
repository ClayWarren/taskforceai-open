import { useMutation, useQueryClient } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

export const useRunTaskMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Parameters<typeof client.runTask>[0]) => client.runTask(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: (error) => {
      mobileLogger.error('[useRunTaskMutation] Failed to run task', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};
