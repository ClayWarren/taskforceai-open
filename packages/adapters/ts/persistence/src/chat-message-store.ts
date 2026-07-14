import { definedProps } from '@taskforceai/client-core/utils/object';

import type { ConversationStore } from './chat-conversation-store';
import type { UpsertMessageParams } from './chat-types';
import type { StorageAdapter, StorageMessage } from './storage-adapter';
import { isStorageNotFoundError, storageReadErrorToError } from './storage-errors';
import { traceOperation } from './trace-operation';

const now = () => Date.now();

const updatedMessage = (
  existing: StorageMessage,
  params: UpsertMessageParams,
  timestamp: number,
  resolvedTraceId: string | undefined
): StorageMessage => {
  const next: StorageMessage = {
    ...existing,
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    isStreaming: params.isStreaming,
    updatedAt: timestamp,
  };
  if (params.sources !== undefined) next.sources = params.sources;
  if (params.toolEvents !== undefined) next.toolEvents = params.toolEvents;
  if (params.agentStatuses !== undefined) next.agentStatuses = params.agentStatuses;
  if (params.error !== undefined) next.error = params.error;
  if (params.isAgentStatus !== undefined) next.isAgentStatus = params.isAgentStatus;
  if (params.isLocalCommandOutput !== undefined)
    next.isLocalCommandOutput = params.isLocalCommandOutput;
  if (params.elapsedSeconds !== undefined) next.elapsedSeconds = params.elapsedSeconds;
  if (resolvedTraceId !== undefined) next.traceId = resolvedTraceId;
  return next;
};

const newMessage = (
  params: UpsertMessageParams,
  timestamp: number,
  resolvedTraceId: string | undefined
): StorageMessage => ({
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
  ...definedProps({
    traceId: resolvedTraceId,
    isAgentStatus: params.isAgentStatus,
    isLocalCommandOutput: params.isLocalCommandOutput,
    elapsedSeconds: params.elapsedSeconds,
    error: params.error,
  }),
});

export class MessageStore {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly conversationStore: ConversationStore
  ) {}

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
        await this.adapter.upsertMessage(
          updatedMessage(existingResult.value, params, timestamp, resolvedTraceId)
        );
      } else if (isStorageNotFoundError(existingResult.error)) {
        await this.adapter.upsertMessage(newMessage(params, timestamp, resolvedTraceId));
      } else {
        throw storageReadErrorToError(existingResult.error);
      }

      const shouldUpdateConversationPreview =
        params.role !== 'system' &&
        params.content.trim().length > 0 &&
        params.isAgentStatus !== true &&
        !hasInheritedAgentStatus;

      if (shouldUpdateConversationPreview) {
        const previewResult = await this.conversationStore.updateLastMessagePreview(
          params.conversationId,
          params.content,
          timestamp
        );
        if (!previewResult.ok && !isStorageNotFoundError(previewResult.error)) {
          throw previewResult.error instanceof Error
            ? previewResult.error
            : storageReadErrorToError(previewResult.error);
        }
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
