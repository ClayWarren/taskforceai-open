import type { StorageMessage } from './storage-adapter';
import type { MessageRole } from '@taskforceai/client-core/chat/types';
import type { SourceReference, ToolUsageEvent } from '@taskforceai/client-core/types';

export type RepositoryConversation = {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview: string | null;
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
  isArchived?: boolean;
};

export type RepositoryMessage = StorageMessage;

export type UpsertMessageParams = {
  conversationId: string;
  messageId: string;
  role: MessageRole;
  content: string;
  isStreaming: boolean;
  isAgentStatus?: boolean;
  isLocalCommandOutput?: boolean;
  elapsedSeconds?: number;
  error?: string | null;
  sources?: SourceReference[];
  toolEvents?: ToolUsageEvent[];
  agentStatuses?: StorageMessage['agentStatuses'];
  traceId?: string;
  trace_id?: string;
  createdAt?: number;
  updatedAt?: number;
};
