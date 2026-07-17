import type { RunRequest } from '@taskforceai/contracts/contracts';
import type { Result } from '@taskforceai/client-core/result';

import { getPersistenceLogger } from './logger';
import { ConversationStore } from './chat-conversation-store';
import { MessageStore } from './chat-message-store';
import { type PendingPrompt, PendingPromptStore } from './chat-pending-store';
import type { RepositoryConversation, RepositoryMessage, UpsertMessageParams } from './chat-types';
import { type SearchIndex, createNoopSearchIndex } from './search-index';
import type { StorageAdapter, StorageMessage } from './storage-adapter';

export type { RepositoryConversation, RepositoryMessage, UpsertMessageParams };

export class ChatRepository {
  private readonly logger = getPersistenceLogger();
  private readonly conversationStore: ConversationStore;
  private readonly messageStore: MessageStore;
  private readonly pendingStore: PendingPromptStore;
  private readonly searchIndex: SearchIndex;
  private readonly hasSearchIndex: boolean;

  constructor(adapter: StorageAdapter, searchIndex?: SearchIndex) {
    this.logger.debug('ChatRepository created');
    this.hasSearchIndex = searchIndex !== undefined;
    this.searchIndex = searchIndex ?? createNoopSearchIndex();
    this.conversationStore = new ConversationStore(adapter);
    this.messageStore = new MessageStore(adapter, this.conversationStore);
    this.pendingStore = new PendingPromptStore(adapter);
  }

  async ensureConversation(conversationId: string, title: string): Promise<void> {
    this.logger.debug('Ensuring conversation exists', { conversationId, title });
    await this.conversationStore.ensureConversation(conversationId, title);
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    this.logger.debug('Renaming conversation', { conversationId, title });
    await this.conversationStore.renameConversation(conversationId, title);
  }

  async setConversationProjectId(conversationId: string, projectId: number | null): Promise<void> {
    this.logger.debug('Updating conversation project', { conversationId, projectId });
    await this.conversationStore.setConversationProjectId(conversationId, projectId);
  }

  async archiveConversation(conversationId: string): Promise<void> {
    this.logger.debug('Archiving conversation', { conversationId });
    await this.conversationStore.archiveConversation(conversationId);
  }

  async restoreConversation(conversationId: string): Promise<void> {
    this.logger.debug('Restoring conversation', { conversationId });
    await this.conversationStore.restoreConversation(conversationId);
  }

  async getConversation(
    conversationId: string
  ): Promise<Result<RepositoryConversation, { kind: 'not_found' | 'storage'; message: string }>> {
    this.logger.debug('Getting conversation', { conversationId });
    return this.conversationStore.getConversation(conversationId);
  }

  async listConversations(limit = 20, offset = 0): Promise<RepositoryConversation[]> {
    this.logger.debug('Listing conversations', { limit, offset });
    return this.conversationStore.listConversations(limit, offset);
  }

  async listArchivedConversations(limit = 100, offset = 0): Promise<RepositoryConversation[]> {
    this.logger.debug('Listing archived conversations', { limit, offset });
    return this.conversationStore.listArchivedConversations(limit, offset);
  }

  async clearConversation(conversationId: string): Promise<void> {
    this.logger.debug('Clearing conversation', { conversationId });
    const messages = this.hasSearchIndex
      ? await this.messageStore.getConversationMessages(conversationId)
      : [];
    await this.conversationStore.clearConversation(conversationId);
    for (const message of messages) {
      this.searchIndex.removeItem(message.messageId);
    }
  }

  async truncateConversation(conversationId: string, fromMessageId: string): Promise<void> {
    this.logger.debug('Truncating conversation', { conversationId, fromMessageId });
    const deleted = await this.messageStore.truncateConversation(conversationId, fromMessageId);
    for (const message of deleted) {
      this.searchIndex.removeItem(message.messageId);
    }
  }

  async archiveAllConversations(): Promise<void> {
    this.logger.debug('Archiving all conversations');
    await this.conversationStore.archiveAllConversations();
  }

  async deleteAllConversations(): Promise<void> {
    this.logger.debug('Deleting all conversations');
    if (!this.hasSearchIndex) {
      await this.conversationStore.deleteAllConversations();
      return;
    }
    const [activeConversations, archivedConversations] = await Promise.all([
      this.conversationStore.listConversations(Number.MAX_SAFE_INTEGER, 0),
      this.conversationStore.listArchivedConversations(Number.MAX_SAFE_INTEGER, 0),
    ]);
    const seen = new Set<string>();
    const conversations = [];
    for (const conversation of [...activeConversations, ...archivedConversations]) {
      if (seen.has(conversation.conversationId)) {
        continue;
      }
      seen.add(conversation.conversationId);
      conversations.push(conversation);
    }
    const messages = (
      await Promise.all(
        conversations.map((conversation) =>
          this.messageStore.getConversationMessages(conversation.conversationId)
        )
      )
    ).flat();
    await this.conversationStore.deleteAllConversations();
    for (const message of messages) {
      this.searchIndex.removeItem(message.messageId);
    }
  }

  async replaceConversationId(oldId: string, newId: string): Promise<void> {
    this.logger.debug('Replacing conversation id', { oldId, newId });
    await this.conversationStore.replaceConversationId(oldId, newId);
  }

  // Pending prompts (mapped onto pending changes)
  async enqueuePrompt(
    conversationId: string,
    prompt: string,
    runPayload?: RunRequest
  ): Promise<void> {
    this.logger.debug('Enqueuing prompt', { conversationId, promptLength: prompt.length });
    await this.pendingStore.enqueuePrompt(conversationId, prompt, runPayload);
  }

  async updatePromptStatus(id: number, status: 'queued' | 'pending' | 'failed'): Promise<void> {
    this.logger.debug('Updating prompt status', { id, status });
    await this.pendingStore.updatePromptStatus(id, status);
  }

  async removePrompt(id: number): Promise<void> {
    this.logger.debug('Removing prompt', { id });
    await this.pendingStore.removePrompt(id);
  }

  async listPendingPrompts(): Promise<PendingPrompt[]> {
    this.logger.debug('Listing pending prompts');
    return this.pendingStore.listPendingPrompts();
  }

  async upsertMessage(params: UpsertMessageParams): Promise<void> {
    const resolvedTraceId = params.traceId ?? params.trace_id;
    this.logger.debug('Upserting message', {
      conversationId: params.conversationId,
      messageId: params.messageId,
      role: params.role,
    });
    await this.messageStore.upsertMessage({
      ...params,
      ...(resolvedTraceId !== undefined && { traceId: resolvedTraceId }),
    });
    this.searchIndex.addItem({
      id: params.messageId,
      title: `${params.role} message`,
      content: params.content,
      tags: [params.conversationId, params.role],
    });
  }

  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<StorageMessage[]> {
    this.logger.debug('Getting conversation messages', { conversationId, limit, offset });
    return this.messageStore.getConversationMessages(conversationId, limit, offset);
  }
}

export const createChatRepository = (adapter: StorageAdapter, searchIndex?: SearchIndex) =>
  new ChatRepository(adapter, searchIndex);
