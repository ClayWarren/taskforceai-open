export const GUEST_CONVERSATION_ID_PREFIX = 'guest';

export const isGuestConversationId = (conversationId: string): boolean =>
  conversationId.startsWith(`${GUEST_CONVERSATION_ID_PREFIX}-`);
