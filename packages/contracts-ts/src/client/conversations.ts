import { z } from 'zod';

import {
  type ConversationSummary,
  conversationListSchema,
  modelSelectorResponseSchema,
} from '../contracts';
import {
  createHelpers,
  encodePathSegment,
  positiveIntegerPathSegment,
  type RequestContext,
} from './helpers';

export const createConversationsClient = (context: RequestContext) => {
  const { get, post, request } = createHelpers(context);

  return {
    getModelOptions: (init?: RequestInit) =>
      get('/api/v1/models', modelSelectorResponseSchema, init),
    getConversations: async (
      limit: number = 50,
      offset: number = 0
    ): Promise<ConversationSummary[]> => {
      const params = new URLSearchParams();
      if (limit > 0) params.append('limit', limit.toString());
      if (offset > 0) params.append('offset', offset.toString());
      const query = params.toString();
      const d = await request(`/api/v1/conversations${query ? `?${query}` : ''}`, {
        method: 'GET',
      });
      return d
        ? (conversationListSchema.parse(d) as { conversations: ConversationSummary[] })
            .conversations
        : [];
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
