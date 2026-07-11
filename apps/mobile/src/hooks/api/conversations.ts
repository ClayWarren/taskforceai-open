import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { getMobileClient } from '../../api/client';
import { mobileLogger } from '../../logger';
import { queryKeys } from './queryKeys';

interface UseConversationsQueryOptions {
  limit?: number;
  enabled?: boolean;
}

export const useConversationsQuery = (options: UseConversationsQueryOptions = {}) => {
  const client = getMobileClient();
  const { limit = 20, enabled = true } = options;

  return useInfiniteQuery({
    queryKey: queryKeys.conversationsPage(limit),
    queryFn: ({ pageParam }) => client.getConversations(limit, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === limit ? allPages.length * limit : undefined;
    },
    enabled,
    staleTime: 60_000,
  });
};

export const useDeleteConversationMutation = () => {
  const client = getMobileClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: number) => {
      await client.deleteConversation(conversationId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
    onError: (error) => {
      mobileLogger.error('[useDeleteConversationMutation] Failed to delete conversation', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error
      });
    },
  });
};
