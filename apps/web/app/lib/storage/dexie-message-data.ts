import { definedProps } from '@taskforceai/client-core/utils/object';
import type { StorageMessage } from '@taskforceai/persistence';

export type DexieMessageData = Omit<StorageMessage, 'id'> & { trace_id?: string };

export function createDexieMessageData(message: StorageMessage): DexieMessageData {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    isStreaming: message.isStreaming,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    syncVersion: message.syncVersion ?? 0,
    lastSyncedAt: message.lastSyncedAt ?? 0,
    isDeleted: message.isDeleted ?? false,
    ...definedProps({
      deviceId: message.deviceId,
      isAgentStatus: message.isAgentStatus,
      isLocalCommandOutput: message.isLocalCommandOutput,
      elapsedSeconds: message.elapsedSeconds,
      error: message.error,
      sources: message.sources,
      toolEvents: message.toolEvents,
      agentStatuses: message.agentStatuses,
      traceId: message.traceId,
      trace_id: message.traceId,
    }),
  };
}
