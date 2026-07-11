import type { ConversationSummary } from '@taskforceai/contracts/contracts';

export interface SidebarLocalConversation {
  conversationId: string;
  title: string;
  updatedAt: number;
  lastMessagePreview?: string | null;
  projectId?: number | null;
}

export function mapLocalConversationToSummary(
  conversation: SidebarLocalConversation,
  syntheticId: number
): ConversationSummary {
  return {
    id: syntheticId,
    timestamp: new Date(conversation.updatedAt).toISOString(),
    user_input: conversation.title || 'Local conversation',
    result: conversation.lastMessagePreview ?? '',
    model: 'local-cache',
    ...(conversation.projectId === null || typeof conversation.projectId === 'number'
      ? { projectId: conversation.projectId }
      : {}),
  };
}

export function createConversationSearchItem(conversation: SidebarLocalConversation) {
  return {
    id: conversation.conversationId,
    title: conversation.title || 'Local conversation',
    content: conversation.lastMessagePreview ?? '',
    tags: [conversation.conversationId, 'conversation'],
  };
}
