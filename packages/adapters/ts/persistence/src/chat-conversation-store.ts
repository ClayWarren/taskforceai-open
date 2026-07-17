import { type Result, err, ok } from '@taskforceai/client-core/result';
import { definedProps } from '@taskforceai/client-core/utils/object';

import { createPreview } from './chat-normalizers';
import type { RepositoryConversation } from './chat-types';
import type { StorageAdapter, StorageConversation, StorageReadError } from './storage-adapter';
import { isStorageNotFoundError, storageReadErrorToError } from './storage-errors';
import { traceOperation } from './trace-operation';

const now = () => Date.now();

export class ConversationStore {
  constructor(private readonly adapter: StorageAdapter) {}

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

  private mergeConversation(
    existing: StorageConversation,
    title: string
  ): StorageConversation | null {
    const nextTitle =
      existing.title && existing.title !== 'New Conversation' ? existing.title : title;
    if (nextTitle === existing.title) {
      return null;
    }
    return {
      ...existing,
      title: nextTitle,
      updatedAt: now(),
    };
  }

  private async updateConversation(
    conversationId: string,
    changes: Partial<StorageConversation>
  ): Promise<void> {
    const existingResult = await this.adapter.getConversation(conversationId);
    if (!existingResult.ok) {
      if (isStorageNotFoundError(existingResult.error)) return;
      throw storageReadErrorToError(existingResult.error);
    }
    await this.adapter.upsertConversation({
      ...existingResult.value,
      ...changes,
      updatedAt: now(),
    });
  }

  async ensureConversation(conversationId: string, title: string): Promise<void> {
    await traceOperation('ConversationStore.ensureConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const timestamp = now();
      const existingResult = await this.adapter.getConversation(conversationId);
      if (existingResult.ok) {
        const nextConversation = this.mergeConversation(existingResult.value, title);
        if (nextConversation) {
          await this.adapter.upsertConversation(nextConversation);
        }
        return;
      }
      if (!isStorageNotFoundError(existingResult.error)) {
        throw storageReadErrorToError(existingResult.error);
      }
      await this.adapter.upsertConversation(
        this.buildConversationBase(title, conversationId, timestamp)
      );
    });
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    await traceOperation('ConversationStore.renameConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);
      await this.updateConversation(conversationId, { title });
    });
  }

  async setConversationProjectId(conversationId: string, projectId: number | null): Promise<void> {
    await traceOperation('ConversationStore.setConversationProjectId', async (span) => {
      span.setAttribute('conversation.id', conversationId);
      if (projectId !== null) span.setAttribute('project.id', projectId);
      await this.updateConversation(conversationId, { projectId });
    });
  }

  async archiveConversation(conversationId: string): Promise<void> {
    await traceOperation('ConversationStore.archiveConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);
      await this.updateConversation(conversationId, { isArchived: true });
    });
  }

  async restoreConversation(conversationId: string): Promise<void> {
    await traceOperation('ConversationStore.restoreConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);
      await this.updateConversation(conversationId, { isArchived: false });
    });
  }

  async getConversation(
    conversationId: string
  ): Promise<Result<RepositoryConversation, StorageReadError>> {
    return await traceOperation('ConversationStore.getConversation', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const result = await this.adapter.getConversation(conversationId);
      if (!result.ok) {
        return err(result.error);
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
  ): Promise<Result<StorageConversation, StorageReadError>> {
    return await traceOperation('ConversationStore.updateLastMessagePreview', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const conversationResult = await this.adapter.getConversation(conversationId);
      if (!conversationResult.ok) return conversationResult;
      const conversation = conversationResult.value;
      if (conversation.lastMessagePreview !== null && timestamp < conversation.updatedAt) {
        return ok(conversation);
      }
      const nextConversation = {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        lastMessagePreview: createPreview(content),
      };
      await this.adapter.upsertConversation(nextConversation);
      return ok(nextConversation);
    });
  }

  async setLastMessagePreview(conversationId: string, content: string | null): Promise<void> {
    await this.updateConversation(conversationId, {
      lastMessagePreview: content ? createPreview(content) : null,
    });
  }

  async updateConversationMetadata(
    conversationId: string,
    updater: (conversation: StorageConversation) => StorageConversation
  ): Promise<Result<StorageConversation, StorageReadError>> {
    return await traceOperation('ConversationStore.updateConversationMetadata', async (span) => {
      span.setAttribute('conversation.id', conversationId);

      const conversationResult = await this.adapter.getConversation(conversationId);
      if (!conversationResult.ok) return conversationResult;
      const conversation = conversationResult.value;
      const nextConversation = updater(conversation);
      await this.adapter.upsertConversation(nextConversation);
      return ok(nextConversation);
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
      ...(record.projectId === null || typeof record.projectId === 'number'
        ? { projectId: record.projectId }
        : {}),
      ...(record.isArchived === true ? { isArchived: true } : {}),
    };
  }
}
