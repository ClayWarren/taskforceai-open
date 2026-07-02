/**
 * Message Repository - Handles message data operations
 */
import { eq, and, asc } from 'drizzle-orm';
import { type Result, err, ok } from '@taskforceai/shared/result';
import { dbManager } from '../database-manager';
import { messages } from '../schema';
import type { IMessageStore, StorageMessage } from '../storage-adapter';
import {
  mapMessageRow,
  toBooleanFlag,
  serializeJson,
  withRepoError,
  withRepoResult,
} from '../utils';

const buildMessageMetadata = (message: StorageMessage): string | null => {
  const metadata: Record<string, unknown> = {};
  if (message.traceId !== undefined) metadata.traceId = message.traceId;
  if (message.isLocalCommandOutput !== undefined) {
    metadata.isLocalCommandOutput = message.isLocalCommandOutput;
  }
  return Object.keys(metadata).length > 0 ? serializeJson(metadata) : null;
};

const buildMessageMutationValues = (message: StorageMessage) => ({
  content: message.content,
  isStreaming: toBooleanFlag(message.isStreaming),
  isAgentStatus: toBooleanFlag(message.isAgentStatus ?? false),
  elapsedSeconds: message.elapsedSeconds ?? null,
  updatedAt: message.updatedAt,
  error: message.error ?? null,
  sources: serializeJson(message.sources ?? []),
  toolEvents: serializeJson(message.toolEvents ?? []),
  agentStatuses: serializeJson(message.agentStatuses ?? []),
  metadata: buildMessageMetadata(message),
  syncVersion: message.syncVersion,
  lastSyncedAt: message.lastSyncedAt,
  deviceId: message.deviceId ?? null,
  isDeleted: toBooleanFlag(message.isDeleted),
});

export class MessageRepository implements IMessageStore {
  async getMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<StorageMessage[]> {
    return withRepoError(
      '[MessageRepository] get messages',
      async () => {
        const db = await dbManager.ensureOrm();
        // Using basic select instead of relational query to avoid potential prepareSync issues
        let rows;
        if (limit !== undefined) {
          rows = await db
            .select()
            .from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.isDeleted, false)))
            .orderBy(asc(messages.createdAt), asc(messages.id))
            .limit(limit)
            .offset(offset ?? 0);
        } else {
          rows = await db
            .select()
            .from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.isDeleted, false)))
            .orderBy(asc(messages.createdAt), asc(messages.id));
        }

        return rows.map(mapMessageRow);
      },
      { conversationId }
    );
  }

  async getMessage(messageId: string): Promise<Result<StorageMessage>> {
    return withRepoResult(
      'MessageRepository.getMessage',
      async () => {
        const db = await dbManager.ensureOrm();
        const row = await db.query.messages.findFirst({
          where: eq(messages.messageId, messageId),
        });
        return row ? ok(mapMessageRow(row)) : err(new Error('Message not found'));
      },
      { messageId }
    );
  }

  async upsertMessage(message: StorageMessage): Promise<void> {
    return withRepoError(
      '[MessageRepository] upsert message',
      async () => {
        const db = await dbManager.ensureOrm();
        const mutationValues = buildMessageMutationValues(message);
        await db
          .insert(messages)
          .values({
            messageId: message.messageId,
            conversationId: message.conversationId,
            role: message.role,
            createdAt: message.createdAt,
            ...mutationValues,
          })
          .onConflictDoUpdate({
            target: messages.messageId,
            set: mutationValues,
          });
      },
      { messageId: message.messageId }
    );
  }

  async deleteMessage(messageId: string): Promise<void> {
    return withRepoError(
      '[MessageRepository] delete message',
      async () => {
        const db = await dbManager.ensureOrm();
        await db.delete(messages).where(eq(messages.messageId, messageId));
      },
      { messageId }
    );
  }
}
