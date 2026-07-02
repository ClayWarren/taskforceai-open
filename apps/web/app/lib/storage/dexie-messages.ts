import Dexie from 'dexie';
import { db } from '@taskforceai/web/lib/dexie-db';
import { mapToStorageMessage } from '@taskforceai/persistence/chat-normalizers';
import { type Result, err, ok } from '@taskforceai/shared/result';
import type { StorageMessage } from '@taskforceai/persistence';

import { createDexieMessageData } from './dexie-message-data';

export const listDexieMessages = async (
  conversationId: string,
  limit?: number,
  offset?: number
): Promise<StorageMessage[]> => {
  let query = db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey]);

  if (offset !== undefined) {
    query = query.offset(offset);
  }
  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const messages = await query.toArray();
  return messages.map(mapToStorageMessage);
};

export const getDexieMessage = async (messageId: string): Promise<Result<StorageMessage>> => {
  const message = await db.messages.where('messageId').equals(messageId).first();
  return message ? ok(mapToStorageMessage(message)) : err(new Error('Message not found'));
};

export const upsertDexieMessage = async (message: StorageMessage): Promise<void> => {
  const existing = await db.messages.where('messageId').equals(message.messageId).first();

  if (existing && existing.id !== undefined) {
    await db.messages.update(existing.id, {
      ...message,
      updatedAt: Date.now(),
    });
    return;
  }

  await db.messages.add(createDexieMessageData(message));
};

export const deleteDexieMessage = async (messageId: string): Promise<void> => {
  await db.messages.where('messageId').equals(messageId).delete();
};
