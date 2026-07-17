import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentInput } from '@taskforceai/api-client/client/agents';

import { getMobileClient } from '../../api/client';
import { queryKeys } from './queryKeys';

export function useAgentsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => getMobileClient().listAgents(),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpsertAgentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AgentInput) => getMobileClient().upsertAgent(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}
