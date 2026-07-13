import { z } from 'zod';

import {
  type ConversationSummary,
  conversationListSchema,
  modelSelectorResponseSchema,
} from '@taskforceai/contracts/contracts';
import {
  createHelpers,
  encodePathSegment,
  positiveIntegerPathSegment,
  type RequestContext,
} from './helpers';

export const createConversationsClient = (context: RequestContext) => {
  const { get, post, request } = createHelpers(context);
  const getConversationsPage = async (limit: number = 50, offset: number = 0) => {
    const params = new URLSearchParams();
    if (limit > 0) params.append('limit', limit.toString());
    if (offset > 0) params.append('offset', offset.toString());
    const query = params.toString();
    const response = await request(`/api/v1/conversations${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
    if (!response) {
      return {
        conversations: [],
        total: 0,
        limit,
        offset,
        has_more: false,
      };
    }
    return conversationListSchema.parse(response);
  };

  return {
    getModelOptions: (init?: RequestInit) =>
      get('/api/v1/models', modelSelectorResponseSchema, init),
    getConversationsPage,
    getConversations: async (
      limit: number = 50,
      offset: number = 0
    ): Promise<ConversationSummary[]> => {
      const page = await getConversationsPage(limit, offset);
      return page.conversations;
    },
    deleteConversation: (id: number) =>
      request(
        `/api/v1/conversations/${positiveIntegerPathSegment(id, 'Conversation ID')}`,
        { method: 'DELETE' },
        { parseJson: false }
      ),
    shareConversation: (
      id: number,
      isPublic: boolean
    ): Promise<{ share_id: string; is_public: boolean; url: string }> =>
      post(
        `/api/v1/conversations/${positiveIntegerPathSegment(id, 'Conversation ID')}/share`,
        { is_public: isPublic },
        z.object({
          share_id: z.string(),
          is_public: z.boolean(),
          url: z.string(),
        })
      ),
    submitMessageFeedback: (messageId: string, rating: number): Promise<void> =>
      request(
        `/api/v1/messages/${encodePathSegment(messageId)}/feedback`,
        {
          method: 'POST',
          headers: context.buildJsonHeaders(),
          body: JSON.stringify({ rating }),
        },
        { parseJson: false }
      ),
  };
};
