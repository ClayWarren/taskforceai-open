import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type PendingPrompt,
  clearPendingPrompts,
  listPendingPrompts,
  removePrompt,
} from '../../storage/chat-local-mobile';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

export const usePendingPromptsQuery = () => {
  return useQuery<PendingPrompt[]>({
    queryKey: queryKeys.pendingPrompts,
    queryFn: async () => {
      const result = await listPendingPrompts();
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    refetchInterval: 30_000,
  });
};

export const useClearPendingPromptsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await clearPendingPrompts();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingPrompts });
    },
    onError: (error) => {
      mobileLogger.error('[useClearPendingPromptsMutation] Failed to clear pending prompts', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};

export const useRemovePendingPromptMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await removePrompt(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingPrompts });
    },
    onError: (error) => {
      mobileLogger.error('[useRemovePendingPromptMutation] Failed to remove pending prompt', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};
