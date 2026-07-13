import type { Result } from '@taskforceai/client-core/result';

import type {
  PendingChange,
  StorageConversation,
  StorageMessage,
  StorageReadError,
} from './storage-adapter';

export interface ConversationStorage {
  getConversations(limit?: number, offset?: number): Promise<StorageConversation[]>;
  getConversation(conversationId: string): Promise<Result<StorageConversation, StorageReadError>>;
  upsertConversation(conversation: StorageConversation): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  replaceConversationId(oldId: string, newId: string): Promise<void>;
}

export interface MessageStorage {
  getMessages(conversationId: string, limit?: number, offset?: number): Promise<StorageMessage[]>;
  getMessage(messageId: string): Promise<Result<StorageMessage, StorageReadError>>;
  upsertMessage(message: StorageMessage): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
}

export interface PendingChangeStorage {
  getPendingChanges(): Promise<PendingChange[]>;
  addPendingChange(change: PendingChange): Promise<void>;
  updatePendingChange(id: number, data: Record<string, unknown>): Promise<void>;
  removePendingChange(id: number): Promise<void>;
  clearPendingChanges(): Promise<void>;
  updatePendingChangeData(id: number, data: unknown): Promise<void>;
}

export interface SyncMetadataStorage {
  getLastSyncVersion(): Promise<number>;
  setLastSyncVersion(version: number): Promise<void>;
  getDeviceId(): Promise<string>;
  setDeviceId(deviceId: string): Promise<void>;
}

export type SyncStorage = ConversationStorage &
  MessageStorage &
  PendingChangeStorage &
  SyncMetadataStorage;
