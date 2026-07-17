import type { RunRequest } from '@taskforceai/contracts/contracts';
import {
  createChatRepository,
  type StorageAdapter,
  type UpsertMessageParams,
} from '@taskforceai/persistence';
import type { Result } from '@taskforceai/client-core/result';

import type {
  ConversationRecord,
  ConversationStore,
  ConversationStoreEvent,
  ConversationStoreSubscriber,
  MessageRecord,
  PendingPromptRecord,
} from './types';

export interface ConversationStoreLogger {
  warn: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
}

export interface PersistentConversationStoreOptions {
  adapter: StorageAdapter;
  logger: ConversationStoreLogger;
}

const MAX_SUBSCRIBER_CONSECUTIVE_FAILURES = 3;

export class PersistentConversationStore implements ConversationStore {
  private readonly repository;
  private readonly subscribers = new Set<ConversationStoreSubscriber>();
  private readonly subscriberFailureCounts = new Map<ConversationStoreSubscriber, number>();

  constructor(private readonly options: PersistentConversationStoreOptions) {
    this.repository = createChatRepository(options.adapter);
  }

  subscribe(listener: ConversationStoreSubscriber): () => void {
    this.subscribers.add(listener);
    this.subscriberFailureCounts.delete(listener);
    return () => {
      this.subscribers.delete(listener);
      this.subscriberFailureCounts.delete(listener);
    };
  }

  private emit(event: ConversationStoreEvent): void {
    for (const listener of Array.from(this.subscribers)) {
      try {
        listener(event);
        this.subscriberFailureCounts.delete(listener);
      } catch (error) {
        const failureCount = (this.subscriberFailureCounts.get(listener) ?? 0) + 1;
        this.subscriberFailureCounts.set(listener, failureCount);
        this.options.logger.error('[PersistentConversationStore] Subscriber error', {
          error,
          eventType: event.type,
          failureCount,
          maxFailures: MAX_SUBSCRIBER_CONSECUTIVE_FAILURES,
        });
        if (failureCount >= MAX_SUBSCRIBER_CONSECUTIVE_FAILURES) {
          this.subscribers.delete(listener);
          this.subscriberFailureCounts.delete(listener);
          this.options.logger.warn(
            '[PersistentConversationStore] Removed subscriber after consecutive failures',
            {
              eventType: event.type,
              failureCount,
              maxFailures: MAX_SUBSCRIBER_CONSECUTIVE_FAILURES,
            }
          );
        }
      }
    }
  }

  async ensureConversation(conversationId: string, title: string): Promise<void> {
    await this.repository.ensureConversation(conversationId, title);
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async renameConversation(conversationId: string, title: string): Promise<void> {
    await this.repository.renameConversation(conversationId, title);
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async setConversationProjectId(conversationId: string, projectId: number | null): Promise<void> {
    await this.repository.setConversationProjectId(conversationId, projectId);
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async archiveConversation(conversationId: string): Promise<void> {
    await this.repository.archiveConversation(conversationId);
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async restoreConversation(conversationId: string): Promise<void> {
    await this.repository.restoreConversation(conversationId);
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async getConversation(
    conversationId: string
  ): Promise<Result<ConversationRecord, { kind: 'not_found' | 'storage'; message: string }>> {
    return this.repository.getConversation(conversationId);
  }

  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<MessageRecord[]> {
    return this.repository.getConversationMessages(conversationId, limit, offset);
  }

  async upsertMessage(params: UpsertMessageParams): Promise<void> {
    await this.repository.upsertMessage(params);
    this.emit({ type: 'messages-changed', conversationId: params.conversationId });
    this.emit({ type: 'conversations-changed', conversationId: params.conversationId });
  }

  async listConversations(limit?: number, offset?: number): Promise<ConversationRecord[]> {
    return this.repository.listConversations(limit, offset);
  }

  async listArchivedConversations(limit?: number, offset?: number): Promise<ConversationRecord[]> {
    return this.repository.listArchivedConversations(limit, offset);
  }

  async clearConversation(conversationId: string): Promise<void> {
    await this.repository.clearConversation(conversationId);
    this.emit({ type: 'conversations-changed', conversationId });
    this.emit({ type: 'messages-changed', conversationId });
  }

  async truncateConversation(conversationId: string, fromMessageId: string): Promise<void> {
    await this.repository.truncateConversation(conversationId, fromMessageId);
    this.emit({ type: 'messages-changed', conversationId });
    this.emit({ type: 'conversations-changed', conversationId });
  }

  async archiveAllConversations(): Promise<void> {
    await this.repository.archiveAllConversations();
    this.emit({ type: 'conversations-changed' });
  }

  async deleteAllConversations(): Promise<void> {
    await this.repository.deleteAllConversations();
    this.emit({ type: 'conversations-changed' });
  }

  async replaceConversationId(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) {
      return;
    }
    await this.repository.replaceConversationId(oldId, newId);
    this.emit({ type: 'conversations-changed', conversationId: oldId });
    this.emit({ type: 'conversations-changed', conversationId: newId });
    this.emit({ type: 'messages-changed', conversationId: newId });
  }

  async enqueuePrompt(
    conversationId: string,
    prompt: string,
    runPayload?: RunRequest
  ): Promise<void> {
    await this.repository.enqueuePrompt(conversationId, prompt, runPayload);
    this.emit({ type: 'pending-prompts-changed', conversationId });
  }

  async updatePromptStatus(id: number, status: PendingPromptRecord['status']): Promise<void> {
    if (typeof id !== 'number') {
      return;
    }
    await this.repository.updatePromptStatus(id, status);
    this.emit({ type: 'pending-prompts-changed' });
  }

  async removePrompt(id: number): Promise<void> {
    await this.repository.removePrompt(id);
    this.emit({ type: 'pending-prompts-changed' });
  }

  async listPendingPrompts(): Promise<PendingPromptRecord[]> {
    return this.repository.listPendingPrompts();
  }
}

export const createPersistentConversationStore = (
  options: PersistentConversationStoreOptions
): ConversationStore => new PersistentConversationStore(options);
