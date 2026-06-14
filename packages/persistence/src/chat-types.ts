import type { StorageMessage } from './storage-adapter';

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
