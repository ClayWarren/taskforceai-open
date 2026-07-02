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
  UnauthorizedSource,
} from './types';
export {
  createHttpSyncClient,
  type HttpSyncClientOptions,
  type SyncRequestOptions,
  type SyncClient,
} from './client';
export type { SyncMetricsCollector } from './metrics';
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
