/**
 * Conversation Repository - Handles conversation data operations
 */
import { and, desc, eq } from 'drizzle-orm';
import { type Result, err, ok } from '@taskforceai/client-core/result';
import { storageFailureError, storageNotFoundError, type StorageReadError } from '@taskforceai/persistence';
import { dbManager } from '../database-manager';
import { conversations, messages } from '@taskforceai/db-sync/drizzle/schema';
import type { IConversationStore, StorageConversation } from '../storage-adapter';
import {
  mapConversationRow,
  toBooleanFlag,
  withRepoError,
  withRepoResult,
} from '../utils';
import { mobileLogger } from '../../logger';

const isMissingDeletedColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /no such column:?\s+(.+\.)?is_deleted/i.test(error.message);
};

const isMissingArchiveColumnError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /no such column:?\s+(.+\.)?is_archived/i.test(error.message);
};

export class ConversationRepository implements IConversationStore {
  async getConversations(limit = 20, offset = 0): Promise<StorageConversation[]> {
    try {
      const db = await dbManager.ensureOrm();
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.isDeleted, false), eq(conversations.isArchived, false)))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows.map(mapConversationRow);
    } catch (error) {
      if (isMissingDeletedColumnError(error)) {
        mobileLogger.warn(
          '[ConversationRepository] Schema mismatch: is_deleted column missing, running fallback query',
          { error }
        );
        const db = await dbManager.ensureOrm();
        const rows = await db
          .select()
          .from(conversations)
          .orderBy(desc(conversations.updatedAt))
          .limit(limit)
          .offset(offset);
        return rows.map(mapConversationRow);
      }
      mobileLogger.error('[ConversationRepository] Failed to get conversations', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      throw error;
    }
  }

  async getArchivedConversations(limit = 100, offset = 0): Promise<StorageConversation[]> {
    try {
      const db = await dbManager.ensureOrm();
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.isDeleted, false), eq(conversations.isArchived, true)))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows.map(mapConversationRow);
    } catch (error) {
      if (isMissingArchiveColumnError(error)) {
        mobileLogger.warn(
          '[ConversationRepository] Schema mismatch: is_archived column missing, returning no archived conversations',
          { error }
        );
        return [];
      }
      mobileLogger.error('[ConversationRepository] Failed to get archived conversations', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      throw error;
    }
  }

  async getConversation(conversationId: string): Promise<Result<StorageConversation, StorageReadError>> {
    return withRepoResult(
      'ConversationRepository.getConversation',
      async () => {
        const db = await dbManager.ensureOrm();
        const rows = await db
          .select()
          .from(conversations)
          .where(eq(conversations.conversationId, conversationId))
          .limit(1);

        const row = rows[0];
        return row ? ok(mapConversationRow(row)) : err(storageNotFoundError('Conversation not found'));
      },
      { conversationId },
      storageFailureError
    );
  }

  async upsertConversation(conversation: StorageConversation): Promise<void> {
    return withRepoError(
      '[ConversationRepository] upsert conversation',
      async () => {
        const db = await dbManager.ensureOrm();
        await db
          .insert(conversations)
          .values({
            conversationId: conversation.conversationId,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            lastMessagePreview: conversation.lastMessagePreview ?? null,
            syncVersion: conversation.syncVersion,
            lastSyncedAt: conversation.lastSyncedAt,
            deviceId: conversation.deviceId ?? null,
            isDeleted: toBooleanFlag(conversation.isDeleted),
            isArchived: toBooleanFlag(conversation.isArchived ?? false),
          })
          .onConflictDoUpdate({
            target: conversations.conversationId,
            set: {
              title: conversation.title,
              updatedAt: conversation.updatedAt,
              lastMessagePreview: conversation.lastMessagePreview ?? null,
              syncVersion: conversation.syncVersion,
              lastSyncedAt: conversation.lastSyncedAt,
              deviceId: conversation.deviceId ?? null,
              isDeleted: toBooleanFlag(conversation.isDeleted),
              isArchived: toBooleanFlag(conversation.isArchived ?? false),
            },
          });
      },
      { conversationId: conversation.conversationId }
    );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return withRepoError(
      '[ConversationRepository] delete conversation',
      async () => {
        const db = await dbManager.ensureOrm();
        await db.transaction(async (tx) => {
          await tx.delete(messages).where(eq(messages.conversationId, conversationId));
          await tx.delete(conversations).where(eq(conversations.conversationId, conversationId));
        });
      },
      { conversationId }
    );
  }

  async archiveAllConversations(): Promise<void> {
    return withRepoError(
      '[ConversationRepository] archive all conversations',
      async () => {
        const db = await dbManager.ensureOrm();
        await db
          .update(conversations)
          .set({ isArchived: true, updatedAt: Date.now() })
          .where(and(eq(conversations.isDeleted, false), eq(conversations.isArchived, false)));
      }
    );
  }

  async deleteAllConversations(): Promise<void> {
    return withRepoError(
      '[ConversationRepository] delete all conversations',
      async () => {
        const db = await dbManager.ensureOrm();
        await db.transaction(async (tx) => {
          await tx.delete(messages);
          await tx.delete(conversations);
        });
      }
    );
  }

  async replaceConversationId(oldId: string, newId: string): Promise<void> {
    return withRepoError(
      '[ConversationRepository] replace conversation ID',
      async () => {
        const db = await dbManager.ensureOrm();
        await db.transaction(async (tx) => {
          await tx
            .update(conversations)
            .set({ conversationId: newId })
            .where(eq(conversations.conversationId, oldId));
          await tx
            .update(messages)
            .set({ conversationId: newId })
            .where(eq(messages.conversationId, oldId));
        });
      },
      { oldId, newId }
    );
  }

  async updateConversationMetadata(
    conversationId: string,
    updates: { updatedAt?: number; lastMessagePreview?: string | null; title?: string }
  ): Promise<void> {
    return withRepoError(
      '[ConversationRepository] update conversation metadata',
      async () => {
        const db = await dbManager.ensureOrm();
        const payload: Partial<typeof conversations.$inferInsert> = {};
        if (typeof updates.updatedAt === 'number') payload.updatedAt = updates.updatedAt;
        if (updates.lastMessagePreview !== undefined)
          payload.lastMessagePreview = updates.lastMessagePreview ?? null;
        if (typeof updates.title === 'string') payload.title = updates.title;

        if (Object.keys(payload).length === 0) return;

        await db
          .update(conversations)
          .set(payload)
          .where(eq(conversations.conversationId, conversationId));
      },
      { conversationId }
    );
  }
}
