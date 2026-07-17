import { getCsrfToken } from '@taskforceai/api-client/auth/csrf';
import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import type { ConversationSummary } from '@taskforceai/contracts/contracts';

export type RemoteConversationPage = {
  conversations: ConversationSummary[];
  hasMore: boolean;
};

export type ConversationSharingState = {
  isPublic: boolean;
  url: string;
};

export const fetchConversationsPage = async (
  limit: number,
  offset: number
): Promise<RemoteConversationPage | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  const page = await getBrowserClient().getConversationsPage(limit, offset);
  return {
    conversations: page.conversations,
    hasMore: page.has_more,
  };
};

export const setConversationSharing = async (
  conversationId: number,
  isPublic: boolean
): Promise<ConversationSharingState> => {
  const client = getBrowserClient({ getCsrfToken });
  const response = await client.shareConversation(conversationId, isPublic);
  return {
    isPublic: response.is_public,
    url: response.url,
  };
};
