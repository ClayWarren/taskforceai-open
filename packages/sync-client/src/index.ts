/**
 * Shared Sync Module
 *
 * Client-safe synchronization types and utilities
 */

export type {
  BroadcastEvent,
  ConversationSyncPayload,
  MessageSyncPayload,
  DeletionRecord,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  ConflictRecord,
} from './types';
export {
  createHttpSyncClient,
  type UnauthorizedSource,
  type HttpSyncClientOptions,
  type SyncClient,
} from './client';
export { SyncManager } from './manager';
export { SyncStatus } from './manager-types';
export type { ConflictInfo, SyncManagerConfig, SyncStats } from './manager-types';
export {
  type PendingChange,
  type StorageAdapter,
  type StorageConversation,
  type StorageMessage,
  type ConversationStorage,
  type MessageStorage,
  type PendingChangeStorage,
  type SyncMetadataStorage,
  type SyncStorage,
} from '@taskforceai/persistence';
export { parseBroadcastEvent } from './utils';
export {
  evaluateRealtimeSyncEvent,
  isRelevantRealtimeSyncEvent,
  isUrgentRealtimeSyncEvent,
} from './realtime-policy';
export {
  ConversationSyncPayloadSchema,
  MessageSyncPayloadSchema,
  DeletionRecordSchema,
  SyncPullResponseSchema,
  ConflictRecordSchema,
  SyncPushResponseSchema,
  SyncStatusResponseSchema,
  TokenResponseSchema,
  ErrorStatusSchema,
} from './validation';
