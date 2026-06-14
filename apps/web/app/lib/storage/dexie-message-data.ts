import type { MessageRole } from '@taskforceai/shared/chat/types';
import type { StorageMessage } from '@taskforceai/persistence';

import type { AgentStatus, SourceReference, ToolUsageEvent } from '../types';

export type DexieMessageData = {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: AgentStatus[];
  traceId?: string;
  syncVersion: number;
  lastSyncedAt: number;
  isDeleted: boolean;
  deviceId?: string;
  trace_id?: string;
};

export function createDexieMessageData(message: StorageMessage): DexieMessageData {
  const messageData: DexieMessageData = {
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
    deviceId: message.deviceId,
  };

  if (message.isAgentStatus !== undefined) {
    messageData.isAgentStatus = message.isAgentStatus;
  }
  if (message.isLocalCommandOutput !== undefined) {
    messageData.isLocalCommandOutput = message.isLocalCommandOutput;
  }
  if (message.elapsedSeconds !== undefined) {
    messageData.elapsedSeconds = message.elapsedSeconds;
  }
  if (message.error !== undefined) {
    messageData.error = message.error;
  }
  if (message.sources !== undefined) {
    messageData.sources = message.sources;
  }
  if (message.toolEvents !== undefined) {
    messageData.toolEvents = message.toolEvents;
  }
  if (message.agentStatuses !== undefined) {
    messageData.agentStatuses = message.agentStatuses;
  }
  if (message.traceId !== undefined) {
    messageData.traceId = message.traceId;
    messageData.trace_id = message.traceId;
  }

  return messageData;
}
