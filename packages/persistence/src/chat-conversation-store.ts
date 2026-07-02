import { type Result, err, ok } from '@taskforceai/shared/result';
import { definedProps } from '@taskforceai/shared/utils/object';

import { createPreview } from './chat-normalizers';
import type { RepositoryConversation } from './chat-types';
import type { StorageAdapter, StorageConversation } from './storage-adapter';
import { traceOperation } from './trace-operation';

const now = () => Date.now();

export class ConversationStore {
  constructor(private readonly adapter: StorageAdapter) {}

  private isNotFoundError(error: unknown): boolean {
    if (error === 'NOT_FOUND') {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('not found');
  }

  private toConversationError(error: unknown): { kind: 'not_found' | 'storage'; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    if (this.isNotFoundError(error)) {
      if (error === 'NOT_FOUND') {
        return { kind: 'not_found', message: 'Conversation not found' };
      }
      return { kind: 'not_found', message };
    }
    return { kind: 'storage', message };
  }

  private buildConversationBase(
    title: string,
    conversationId: string,
    createdAt: number
  ): StorageConversation {
    return {
      conversationId,
      title,
      createdAt,
      updatedAt: createdAt,
      lastMessagePreview: null,
      syncVersion: 0,
      lastSyncedAt: 0,
      isDeleted: false,
    };
  }

  private mergeConversation(existing: StorageConversation, title: string): StorageConversation {
    return {
      ...existing,
      title: existing.title && existing.title !== 'New Conversation' ? existing.title : title,
      updatedAt: now(),
    };
  }

  async ensureConversation(conversationId: string, title: string): Promise<void> {
    await traceOperation('ConversationStore.ensureConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const timestamp = now();
      const existingResult = await this.adapter.getConversation(conversationId);
      if (existingResult.ok) {
        await this.adapter.upsertConversation(this.mergeConversation(existingResult.value, title));
        return;
      }
      if (!this.isNotFoundError(existingResult.error)) {
        throw existingResult.error instanceof Error
          ? existingResult.error
          : new Error(String(existingResult.error));
      }
      await this.adapter.upsertConversation(
        this.buildConversationBase(title, conversationId, timestamp)
      );
    });
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    await traceOperation('ConversationStore.renameConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const existingResult = await this.adapter.getConversation(conversationId);
      if (!existingResult.ok) {
        if (this.isNotFoundError(existingResult.error)) {
          return;
        }
        throw existingResult.error instanceof Error
          ? existingResult.error
          : new Error(String(existingResult.error));
      }
      await this.adapter.upsertConversation({ ...existingResult.value, title, updatedAt: now() });
    });
  }

  async archiveConversation(conversationId: string): Promise<void> {
    await traceOperation('ConversationStore.archiveConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const existingResult = await this.adapter.getConversation(conversationId);
      if (!existingResult.ok) {
        if (this.isNotFoundError(existingResult.error)) {
          return;
        }
        throw existingResult.error instanceof Error
          ? existingResult.error
          : new Error(String(existingResult.error));
      }
      await this.adapter.upsertConversation({
        ...existingResult.value,
        isArchived: true,
        updatedAt: now(),
      });
    });
  }

  async restoreConversation(conversationId: string): Promise<void> {
    await traceOperation('ConversationStore.restoreConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const existingResult = await this.adapter.getConversation(conversationId);
      if (!existingResult.ok) {
        if (this.isNotFoundError(existingResult.error)) {
          return;
        }
        throw existingResult.error instanceof Error
          ? existingResult.error
          : new Error(String(existingResult.error));
      }
      await this.adapter.upsertConversation({
        ...existingResult.value,
        isArchived: false,
        updatedAt: now(),
      });
    });
  }

  async getConversation(
    conversationId: string
  ): Promise<Result<RepositoryConversation, { kind: 'not_found' | 'storage'; message: string }>> {
    return await traceOperation('ConversationStore.getConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const result = await this.adapter.getConversation(conversationId);
      if (!result.ok) {
        return err(this.toConversationError(result.error));
      }
      return ok(this.toRepositoryConversation(result.value));
    });
  }

  async listConversations(limit = 20, offset = 0): Promise<RepositoryConversation[]> {
    return await traceOperation('ConversationStore.listConversations', async (span) => {
      span.setAttribute('limit', limit);
      span.setAttribute('offset', offset);

      const records = await this.adapter.getConversations(limit, offset);
      return records.map((record) => this.toRepositoryConversation(record));
    });
  }

  async listArchivedConversations(limit = 100, offset = 0): Promise<RepositoryConversation[]> {
    return await traceOperation('ConversationStore.listArchivedConversations', async (span) => {
      span.setAttribute('limit', limit);
      span.setAttribute('offset', offset);

      const records = this.adapter.getArchivedConversations
        ? await this.adapter.getArchivedConversations(limit, offset)
        : [];
      return records.map((record) => this.toRepositoryConversation(record));
    });
  }

  async clearConversation(conversationId: string): Promise<void> {
    await traceOperation('ConversationStore.clearConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      await this.adapter.deleteConversation(conversationId);
    });
  }

  async archiveAllConversations(): Promise<void> {
    await traceOperation('ConversationStore.archiveAllConversations', async () => {
      if (this.adapter.archiveAllConversations) {
        await this.adapter.archiveAllConversations();
        return;
      }

      const activeConversations = await this.adapter.getConversations(Number.MAX_SAFE_INTEGER, 0);
      const timestamp = now();
      await Promise.all(
        activeConversations.map((conversation) =>
          this.adapter.upsertConversation({
            ...conversation,
            isArchived: true,
            updatedAt: timestamp,
          })
        )
      );
    });
  }

  async deleteAllConversations(): Promise<void> {
    await traceOperation('ConversationStore.deleteAllConversations', async () => {
      if (this.adapter.deleteAllConversations) {
        await this.adapter.deleteAllConversations();
        return;
      }

      const activeConversations = await this.adapter.getConversations(Number.MAX_SAFE_INTEGER, 0);
      const archivedConversations = this.adapter.getArchivedConversations
        ? await this.adapter.getArchivedConversations(Number.MAX_SAFE_INTEGER, 0)
        : [];
      const seen = new Set<string>();
      const conversations = [];
      for (const conversation of [...activeConversations, ...archivedConversations]) {
        if (seen.has(conversation.conversationId)) {
          continue;
        }
        seen.add(conversation.conversationId);
        conversations.push(conversation);
      }
      await Promise.all(
        conversations.map((conversation) =>
          this.adapter.deleteConversation(conversation.conversationId)
        )
      );
    });
  }

  async replaceConversationId(oldId: string, newId: string): Promise<void> {
    await traceOperation('ConversationStore.replaceConversationId', async (span) => {
      span.setAttribute('conversation.old_id', oldId);
      span.setAttribute('conversation.new_id', newId);

      if (oldId === newId) {
        return;
      }
      await this.adapter.replaceConversationId(oldId, newId);
    });
  }

  async updateLastMessagePreview(
    conversationId: string,
    content: string,
    timestamp: number
  ): Promise<Result<StorageConversation>> {
    return await traceOperation('ConversationStore.updateLastMessagePreview', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const conversationResult = await this.adapter.getConversation(conversationId);
      if (!conversationResult.ok) return conversationResult;
      const conversation = conversationResult.value;
      await this.adapter.upsertConversation({
        ...conversation,
        updatedAt: timestamp,
        lastMessagePreview: createPreview(content),
      });
      return conversationResult;
    });
  }

  async updateConversationMetadata(
    conversationId: string,
    updater: (conversation: StorageConversation) => StorageConversation
  ): Promise<Result<StorageConversation>> {
    return await traceOperation('ConversationStore.updateConversationMetadata', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const conversationResult = await this.adapter.getConversation(conversationId);
      if (!conversationResult.ok) return conversationResult;
      const conversation = conversationResult.value;
      await this.adapter.upsertConversation(updater(conversation));
      return conversationResult;
    });
  }

  private toRepositoryConversation(record: StorageConversation): RepositoryConversation {
    return {
      conversationId: record.conversationId,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastMessagePreview: record.lastMessagePreview ?? null,
      syncVersion: record.syncVersion,
      lastSyncedAt: record.lastSyncedAt,
      isDeleted: record.isDeleted,
      ...definedProps({ deviceId: record.deviceId }),
      ...(record.isArchived === true ? { isArchived: true } : {}),
    };
  }
}
