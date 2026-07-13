/**
 * Storage Adapter - Platform-agnostic storage interface
 *
 * Provides unified API for local storage across web (IndexedDB), mobile (SQLite), and desktop.
 */
import type { MessageRole } from '@taskforceai/client-core/chat/types';
import type { Result } from '@taskforceai/client-core/result';
import type {
  AgentStatusSnapshot,
  SourceReference,
  ToolUsageEvent,
} from '@taskforceai/client-core/types';

export type StorageReadError = { kind: 'not_found' | 'storage'; message: string };

export interface StorageConversation {
  id?: number;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string | null;
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
  isArchived?: boolean;
}

export interface StorageMessage {
  id?: number;
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
  agentStatuses?: AgentStatusSnapshot[];
  traceId?: string;
  syncVersion: number;
  lastSyncedAt: number;
  deviceId?: string;
  isDeleted: boolean;
}

export interface PendingChange {
  id?: number;
  type: 'conversation' | 'message' | 'deletion' | 'prompt';
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  data: unknown;
  createdAt: number;
}

/**
 * Storage adapter interface that all platforms must implement.
 */
export interface StorageAdapter {
  /**
   * Conversations
   */
  getConversations(limit?: number, offset?: number): Promise<StorageConversation[]>;
  getArchivedConversations?(limit?: number, offset?: number): Promise<StorageConversation[]>;
  getConversation(conversationId: string): Promise<Result<StorageConversation, StorageReadError>>;
  upsertConversation(conversation: StorageConversation): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  archiveAllConversations?(): Promise<void>;
  deleteAllConversations?(): Promise<void>;
  replaceConversationId(oldId: string, newId: string): Promise<void>;

  /**
   * Messages
   */
  getMessages(conversationId: string, limit?: number, offset?: number): Promise<StorageMessage[]>;
  getMessage(messageId: string): Promise<Result<StorageMessage, StorageReadError>>;
  upsertMessage(message: StorageMessage): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;

  /**
   * Pending changes (for offline sync)
   */
  getPendingChanges(): Promise<PendingChange[]>;
  addPendingChange(change: PendingChange): Promise<void>;
  updatePendingChange(id: number, data: Record<string, unknown>): Promise<void>;
  removePendingChange(id: number): Promise<void>;
  clearPendingChanges(): Promise<void>;
  updatePendingChangeData(id: number, data: unknown): Promise<void>;

  /**
   * Sync metadata
   */
  getLastSyncVersion(): Promise<number>;
  setLastSyncVersion(version: number): Promise<void>;
  getDeviceId(): Promise<string>;
  setDeviceId(deviceId: string): Promise<void>;

  /**
   * Cleanup
   */
  clearAll(): Promise<void>;
}
