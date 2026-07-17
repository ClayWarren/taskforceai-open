import { useQuery } from '@tanstack/react-query';
import type { ActiveTask } from '@taskforceai/contracts/contracts';

import { getMobileClient } from '../../api/client';
import { queryKeys } from './queryKeys';

const isCloudTask = (task: ActiveTask): boolean => task.source !== 'desktop';

export const useCloudTasksQuery = (enabled: boolean) =>
  useQuery<ActiveTask[]>({
    queryKey: queryKeys.cloudTasks,
    queryFn: async () => {
      const response = await getMobileClient().listActiveTasks(50);
      return response.tasks.filter(isCloudTask);
    },
    enabled,
    refetchInterval: enabled ? 5_000 : false,
    staleTime: 2_000,
  });
