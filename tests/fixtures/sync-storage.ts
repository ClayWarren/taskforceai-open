import type {
  PendingChange,
  StorageAdapter,
  StorageConversation,
  StorageMessage,
  StorageReadError,
  SyncStorage,
} from '@taskforceai/persistence';
import {
  isStorageReadError,
  storageFailureError,
  storageNotFoundError,
} from '@taskforceai/persistence';
import { ok } from '@taskforceai/client-core/result';
import { vi } from 'bun:test';

import type {
  ConversationSyncPayload,
  DeletionRecord,
  MessageSyncPayload,
  SyncPullResponse,
  SyncPushResponse,
} from '../../packages/adapters/ts/sync-client/src/types';

export type StorageAdapterMock = {
  [K in keyof StorageAdapter]-?: ReturnType<typeof vi.fn<NonNullable<StorageAdapter[K]>>>;
};

export type SyncStorageMock = {
  [K in keyof SyncStorage]: ReturnType<typeof vi.fn<SyncStorage[K]>>;
};

export const storageConversation = (
  overrides: Partial<StorageConversation> = {}
): StorageConversation => {
  const now = Date.now();
  return {
    conversationId: 'conv-1',
    title: 'Conversation',
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: null,
    syncVersion: 0,
    lastSyncedAt: 0,
    isDeleted: false,
    ...overrides,
  };
};

export const storageMessage = (overrides: Partial<StorageMessage> = {}): StorageMessage => {
  const now = Date.now();
  return {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'hello',
    isStreaming: false,
    createdAt: now,
    updatedAt: now,
    syncVersion: 0,
    lastSyncedAt: 0,
    isDeleted: false,
    ...overrides,
  };
};

const toStorageReadFixtureError = (error: unknown, notFoundMessage: string): StorageReadError => {
  if (isStorageReadError(error)) {
    return error;
  }
  if (error === 'NOT_FOUND') {
    return storageNotFoundError(notFoundMessage);
  }
  return storageFailureError(error);
};

export const conversationResultError = (
  error: unknown
): Awaited<ReturnType<StorageAdapter['getConversation']>> => ({
  ok: false,
  error: toStorageReadFixtureError(error, 'Conversation not found'),
});

export const messageResultError = (
  error: unknown
): Awaited<ReturnType<StorageAdapter['getMessage']>> => ({
  ok: false,
  error: toStorageReadFixtureError(error, 'Message not found'),
});

export const createStorageMock = (
  options: {
    conversation?: Partial<StorageConversation>;
    message?: Partial<StorageMessage>;
  } = {}
): StorageAdapterMock => {
  const defaultConversation = storageConversation(options.conversation);
  const defaultMessage = storageMessage(options.message);

  return {
    getConversations: vi.fn<StorageAdapter['getConversations']>().mockResolvedValue([]),
    getArchivedConversations: vi
      .fn<NonNullable<StorageAdapter['getArchivedConversations']>>()
      .mockResolvedValue([]),
    getConversation: vi
      .fn<StorageAdapter['getConversation']>()
      .mockResolvedValue(ok(defaultConversation)),
    upsertConversation: vi.fn<StorageAdapter['upsertConversation']>().mockResolvedValue(undefined),
    deleteConversation: vi.fn<StorageAdapter['deleteConversation']>().mockResolvedValue(undefined),
    archiveAllConversations: vi
      .fn<NonNullable<StorageAdapter['archiveAllConversations']>>()
      .mockResolvedValue(undefined),
    deleteAllConversations: vi
      .fn<NonNullable<StorageAdapter['deleteAllConversations']>>()
      .mockResolvedValue(undefined),
    replaceConversationId: vi
      .fn<StorageAdapter['replaceConversationId']>()
      .mockResolvedValue(undefined),
    getMessages: vi.fn<StorageAdapter['getMessages']>().mockResolvedValue([]),
    getMessage: vi.fn<StorageAdapter['getMessage']>().mockResolvedValue(ok(defaultMessage)),
    upsertMessage: vi.fn<StorageAdapter['upsertMessage']>().mockResolvedValue(undefined),
    deleteMessage: vi.fn<StorageAdapter['deleteMessage']>().mockResolvedValue(undefined),
    getPendingChanges: vi.fn<StorageAdapter['getPendingChanges']>().mockResolvedValue([]),
    addPendingChange: vi.fn<StorageAdapter['addPendingChange']>().mockResolvedValue(undefined),
    updatePendingChange: vi
      .fn<StorageAdapter['updatePendingChange']>()
      .mockResolvedValue(undefined),
    removePendingChange: vi
      .fn<StorageAdapter['removePendingChange']>()
      .mockResolvedValue(undefined),
    clearPendingChanges: vi
      .fn<StorageAdapter['clearPendingChanges']>()
      .mockResolvedValue(undefined),
    updatePendingChangeData: vi
      .fn<StorageAdapter['updatePendingChangeData']>()
      .mockResolvedValue(undefined),
    getLastSyncVersion: vi.fn<StorageAdapter['getLastSyncVersion']>().mockResolvedValue(0),
    setLastSyncVersion: vi.fn<StorageAdapter['setLastSyncVersion']>().mockResolvedValue(undefined),
    getDeviceId: vi.fn<StorageAdapter['getDeviceId']>().mockResolvedValue('device-1'),
    setDeviceId: vi.fn<StorageAdapter['setDeviceId']>().mockResolvedValue(undefined),
    clearAll: vi.fn<StorageAdapter['clearAll']>().mockResolvedValue(undefined),
  };
};

export const pendingChange = (overrides: Partial<PendingChange> = {}): PendingChange => ({
  id: 1,
  type: 'conversation',
  entityId: 'local-1',
  operation: 'create',
  data: {},
  createdAt: Date.now(),
  ...overrides,
});

export const syncConversation = (
  overrides: Partial<ConversationSyncPayload> = {}
): ConversationSyncPayload => {
  const now = new Date().toISOString();
  return {
    id: 1,
    user_input: 'Hello',
    timestamp: now,
    updated_at: now,
    sync_version: 1,
    last_synced_at: now,
    is_deleted: false,
    ...overrides,
  };
};

export const syncMessage = (overrides: Partial<MessageSyncPayload> = {}): MessageSyncPayload => {
  const now = new Date().toISOString();
  return {
    message_id: 'msg-1',
    conversation_id: 1,
    role: 'assistant',
    content: 'Hi',
    is_streaming: false,
    is_agent_status: false,
    created_at: now,
    updated_at: now,
    error: undefined,
    sources: [],
    tool_events: [],
    sync_version: 1,
    last_synced_at: now,
    is_deleted: false,
    ...overrides,
  };
};

export const syncDeletion = (overrides: Partial<DeletionRecord> = {}): DeletionRecord => ({
  type: 'conversation',
  id: 'conv-del',
  deleted_at: new Date().toISOString(),
  ...overrides,
});

export const pullResponse = (overrides: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
  conversations: [],
  messages: [],
  deletions: [],
  latest_version: 1,
  ...overrides,
});

export const pushResponse = (overrides: Partial<SyncPushResponse> = {}): SyncPushResponse => ({
  accepted: [],
  conflicts: [],
  new_version: 1,
  conversation_id_mappings: {},
  ...overrides,
});
