import { definedProps } from '@taskforceai/shared/utils/object';

import type { ConversationStore } from './chat-conversation-store';
import type { UpsertMessageParams } from './chat-types';
import type { StorageAdapter, StorageMessage } from './storage-adapter';
import { traceOperation } from './trace-operation';

const now = () => Date.now();

export class MessageStore {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly conversationStore: ConversationStore
  ) {}

  private isNotFoundError(error: unknown): boolean {
    if (error === 'NOT_FOUND') {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('not found');
  }

  async upsertMessage(params: UpsertMessageParams): Promise<void> {
    await traceOperation('MessageStore.upsertMessage', async (span) => {
      const resolvedTraceId = params.traceId ?? params.trace_id;
      span.setAttribute('conversation.id', params.conversationId);
      span.setAttribute('message.id', params.messageId);
      span.setAttribute('message.role', params.role);
      if (resolvedTraceId) {
        span.setAttribute('message.traceId', resolvedTraceId);
      }

      const existingResult = await this.adapter.getMessage(params.messageId);
      const timestamp = params.updatedAt ?? now();
      const hasInheritedAgentStatus =
        existingResult.ok &&
        existingResult.value.isAgentStatus === true &&
        params.isAgentStatus === undefined;

      if (existingResult.ok) {
        const existing = existingResult.value;
        const next: StorageMessage = {
          ...existing,
          conversationId: params.conversationId,
          role: params.role,
          content: params.content,
          isStreaming: params.isStreaming,
          updatedAt: timestamp,
        };
        // Only include optional properties if they are defined
        if (params.sources !== undefined) next.sources = params.sources;
        else if (existing.sources !== undefined) next.sources = existing.sources;

        if (params.toolEvents !== undefined) next.toolEvents = params.toolEvents;
        else if (existing.toolEvents !== undefined) next.toolEvents = existing.toolEvents;

        if (params.agentStatuses !== undefined) next.agentStatuses = params.agentStatuses;
        else if (existing.agentStatuses !== undefined) next.agentStatuses = existing.agentStatuses;

        if (params.error !== undefined) next.error = params.error;
        if (params.isAgentStatus !== undefined) next.isAgentStatus = params.isAgentStatus;
        if (params.isLocalCommandOutput !== undefined) {
          next.isLocalCommandOutput = params.isLocalCommandOutput;
        }
        if (params.elapsedSeconds !== undefined) next.elapsedSeconds = params.elapsedSeconds;
        if (resolvedTraceId !== undefined) next.traceId = resolvedTraceId;
        else if (existing.traceId !== undefined) next.traceId = existing.traceId;
        await this.adapter.upsertMessage(next);
      } else if (this.isNotFoundError(existingResult.error)) {
        const next: StorageMessage = {
          messageId: params.messageId,
          conversationId: params.conversationId,
          role: params.role,
          content: params.content,
          isStreaming: params.isStreaming,
          createdAt: params.createdAt ?? timestamp,
          updatedAt: timestamp,
          sources: params.sources ?? [],
          toolEvents: params.toolEvents ?? [],
          agentStatuses: params.agentStatuses ?? [],
          syncVersion: 0,
          lastSyncedAt: 0,
          isDeleted: false,
          ...definedProps({ traceId: resolvedTraceId }),
        };
        if (params.isAgentStatus !== undefined) next.isAgentStatus = params.isAgentStatus;
        if (params.isLocalCommandOutput !== undefined) {
          next.isLocalCommandOutput = params.isLocalCommandOutput;
        }
        if (params.elapsedSeconds !== undefined) next.elapsedSeconds = params.elapsedSeconds;
        if (params.error !== undefined) next.error = params.error;
        await this.adapter.upsertMessage(next);
      } else {
        throw existingResult.error instanceof Error
          ? existingResult.error
          : new Error(String(existingResult.error));
      }

      const shouldUpdateConversationPreview =
        params.role !== 'system' &&
        params.content.trim().length > 0 &&
        params.isAgentStatus !== true &&
        !hasInheritedAgentStatus;

      if (shouldUpdateConversationPreview) {
        await this.conversationStore.updateLastMessagePreview(
          params.conversationId,
          params.content,
          timestamp
        );
      }
    });
  }

  async getConversationMessages(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<StorageMessage[]> {
    return await traceOperation('MessageStore.getConversationMessages', async (span) => {
      span.setAttribute('conversation.id', conversationId);
      if (limit !== undefined) span.setAttribute('limit', limit);
      if (offset !== undefined) span.setAttribute('offset', offset);
      return await this.adapter.getMessages(conversationId, limit, offset);
    });
  }
}
