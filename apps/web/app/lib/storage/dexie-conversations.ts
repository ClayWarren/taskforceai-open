import { db } from '@taskforceai/web/lib/dexie-db';
import { mapToStorageConversation } from '@taskforceai/persistence/chat-normalizers';
import { type Result, err, ok } from '@taskforceai/shared/result';
import type { StorageConversation } from '@taskforceai/persistence';

export const listDexieConversations = async (
  limit: number,
  offset: number
): Promise<StorageConversation[]> => {
  const conversations = await db.conversations
    .orderBy('updatedAt')
    // eslint-disable-next-line unicorn/no-array-reverse -- Dexie Collection#reverse(), not Array#reverse()
    .reverse()
    .filter((conversation) => conversation.isArchived !== true)
    .offset(offset)
    .limit(limit)
    .toArray();
  return conversations.map(mapToStorageConversation);
};

export const listArchivedDexieConversations = async (
  limit: number,
  offset: number
): Promise<StorageConversation[]> => {
  const conversations = await db.conversations
    .orderBy('updatedAt')
    // eslint-disable-next-line unicorn/no-array-reverse -- Dexie Collection#reverse(), not Array#reverse()
    .reverse()
    .filter((conversation) => conversation.isArchived === true)
    .offset(offset)
    .limit(limit)
    .toArray();
  return conversations.map(mapToStorageConversation);
};

export const getDexieConversation = async (
  conversationId: string
): Promise<Result<StorageConversation>> => {
  const conversation = await db.conversations
    .where('conversationId')
    .equals(conversationId)
    .first();
  return conversation
    ? ok(mapToStorageConversation(conversation))
    : err(new Error('Conversation not found'));
};

export const upsertDexieConversation = async (conversation: StorageConversation): Promise<void> => {
  const existing = await db.conversations
    .where('conversationId')
    .equals(conversation.conversationId)
    .first();

  if (existing && existing.id != null) {
    await db.conversations.update(existing.id, {
      ...conversation,
    });
    return;
  }

  await db.conversations.add({
    conversationId: conversation.conversationId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    syncVersion: conversation.syncVersion ?? 0,
    lastSyncedAt: conversation.lastSyncedAt ?? 0,
    isDeleted: conversation.isDeleted ?? false,
    isArchived: conversation.isArchived === true,
    deviceId: conversation.deviceId,
  });
};

export const deleteDexieConversation = async (conversationId: string): Promise<void> => {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.conversations.where('conversationId').equals(conversationId).delete();
    await db.messages.where('conversationId').equals(conversationId).delete();
  });
};

export const archiveAllDexieConversations = async (): Promise<void> => {
  await db.conversations
    .filter((conversation) => !conversation.isDeleted && !conversation.isArchived)
    .modify({ isArchived: true, updatedAt: Date.now() });
};

export const deleteAllDexieConversations = async (): Promise<void> => {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.conversations.clear();
    await db.messages.clear();
  });
};

export const replaceDexieConversationId = async (oldId: string, newId: string): Promise<void> => {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    const existing = await db.conversations.where('conversationId').equals(oldId).first();
    if (existing && existing.id !== undefined) {
      await db.conversations.update(existing.id, { conversationId: newId });
      await db.messages.where('conversationId').equals(oldId).modify({ conversationId: newId });
    }
  });
};
