import type { ConversationSummary } from '@taskforceai/contracts/contracts';
import { localSearch } from '@taskforceai/shared';
import type { Message } from '@taskforceai/shared/chat/types';
import { createId } from '@taskforceai/shared/utils/id';

import type { ConversationStore, KeyValueStorage, MessageRecord } from './types';

export const DEFAULT_MESSAGES_PAGE_SIZE = 50;

export interface ConversationSnapshot {
  conversationId: string;
  messages: Message[];
}

export interface LoadedConversationSnapshot extends ConversationSnapshot {
  hasMoreMessages: boolean;
  isPublic: boolean;
  shareId: string | null;
}

const hydrateMessageRecord = (record: MessageRecord): Message => {
  const message: Message = {
    id: record.messageId,
    content: record.content,
    role: record.role,
    sources: record.sources ?? [],
    toolEvents: record.toolEvents ?? [],
    agentStatuses: record.agentStatuses ?? [],
    trace_id: record.trace_id,
  };

  if (record.isStreaming !== undefined) message.isStreaming = record.isStreaming;
  if (record.isAgentStatus !== undefined) message.isAgentStatus = record.isAgentStatus;
  if (record.isLocalCommandOutput !== undefined) {
    message.isLocalCommandOutput = record.isLocalCommandOutput;
  }
  if (record.elapsedSeconds !== undefined) message.elapsedSeconds = record.elapsedSeconds;
  if (record.createdAt !== undefined) message.createdAt = record.createdAt;
  if (record.updatedAt !== undefined) message.updatedAt = record.updatedAt;

  return message;
};

export const hydrateMessageRecords = (records: MessageRecord[]): Message[] =>
  records.map(hydrateMessageRecord);

export const resolveConversationStorageId = (conversation: ConversationSummary): string =>
  conversation.id > 0
    ? `remote-${conversation.id}`
    : conversation.model || `local-${Math.abs(conversation.id)}`;

export async function restoreConversationSnapshot(options: {
  conversationStore: ConversationStore;
  storage: KeyValueStorage;
  activeConversationKey: string;
  shouldAbort?: () => boolean;
}): Promise<ConversationSnapshot | null> {
  const { conversationStore, storage, activeConversationKey, shouldAbort } = options;
  const savedId = await storage.getItem(activeConversationKey);
  if (shouldAbort?.()) {
    return null;
  }
  if (!savedId) {
    return null;
  }

  const conversationResult = await conversationStore.getConversation(savedId);
  if (shouldAbort?.()) {
    return null;
  }
  if (!conversationResult.ok) {
    if (!shouldAbort?.()) {
      await storage.removeItem(activeConversationKey);
    }
    return null;
  }

  const storedMessages = await conversationStore.getConversationMessages(savedId);
  if (shouldAbort?.()) {
    return null;
  }
  return {
    conversationId: savedId,
    messages: hydrateMessageRecords(storedMessages),
  };
}

export async function createConversation(options: {
  conversationStore: ConversationStore;
  storage: KeyValueStorage;
  activeConversationKey: string;
}): Promise<string> {
  const { conversationStore, storage, activeConversationKey } = options;
  const conversationId = createId('local');
  await conversationStore.ensureConversation(conversationId, 'New Conversation');
  await storage.setItem(activeConversationKey, conversationId);
  return conversationId;
}

export async function appendUserMessage(options: {
  conversationStore: ConversationStore;
  conversationId: string;
  content: string;
}): Promise<Message> {
  const { conversationStore, conversationId, content } = options;
  const messageId = createId('user');
  const now = Date.now();
  const userMessage: Message = {
    id: messageId,
    content,
    role: 'user',
    sources: [],
    createdAt: now,
    updatedAt: now,
  };

  const conversationTitle = content.trim().slice(0, 120) || 'New Conversation';
  await conversationStore.ensureConversation(conversationId, conversationTitle);
  await conversationStore.upsertMessage({
    conversationId,
    messageId,
    role: 'user',
    content,
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
  });

  localSearch.addItem({
    id: messageId,
    title: conversationTitle,
    content,
    tags: [conversationId, 'user'],
  });

  return userMessage;
}

export async function loadConversationSnapshot(options: {
  conversationStore: ConversationStore;
  storage?: KeyValueStorage;
  activeConversationKey?: string;
  conversation: ConversationSummary;
  pageSize?: number;
}): Promise<LoadedConversationSnapshot> {
  const { conversationStore, storage, activeConversationKey, conversation } = options;
  const pageSize = options.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const conversationId = resolveConversationStorageId(conversation);
  const loadedMessages = await conversationStore.getConversationMessages(
    conversationId,
    pageSize,
    0
  );
  if (storage && activeConversationKey) {
    await storage.setItem(activeConversationKey, conversationId);
  }

  return {
    conversationId,
    messages: hydrateMessageRecords(loadedMessages),
    hasMoreMessages: loadedMessages.length === pageSize,
    isPublic: 'isPublic' in conversation ? Boolean(conversation.isPublic) : false,
    shareId: 'shareId' in conversation ? (conversation.shareId ?? null) : null,
  };
}

export async function loadMoreConversationMessages(options: {
  conversationStore: ConversationStore;
  conversationId: string;
  offset: number;
  pageSize?: number;
}): Promise<{ messages: Message[]; hasMoreMessages: boolean }> {
  const { conversationStore, conversationId, offset } = options;
  const pageSize = options.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;
  const moreMessages = await conversationStore.getConversationMessages(
    conversationId,
    pageSize,
    offset
  );

  return {
    messages: hydrateMessageRecords(moreMessages),
    hasMoreMessages: moreMessages.length === pageSize,
  };
}
