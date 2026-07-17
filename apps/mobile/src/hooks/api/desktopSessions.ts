import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActiveTask, ApproveTaskRequest } from '@taskforceai/contracts/contracts';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

const isDesktopSession = (task: ActiveTask) => task.source === 'desktop';

export const useDesktopSessionsQuery = () => {
  const client = getMobileClient();

  return useQuery<ActiveTask[]>({
    queryKey: queryKeys.desktopSessions,
    queryFn: async () => {
      const response = await client.listActiveTasks(25);
      return response.tasks.filter(isDesktopSession);
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
};

export const useApproveDesktopSessionMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, decision }: { taskId: string; decision: ApproveTaskRequest }) =>
      client.approveTask(taskId, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.desktopSessions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: (error) => {
      mobileLogger.error('[useApproveDesktopSessionMutation] Failed to submit session approval', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    },
  });
};
