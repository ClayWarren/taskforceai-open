import { z } from 'zod';

export const ConversationSyncPayloadSchema = z.object({
  id: z.number().optional(),
  local_id: z.string().optional(),
  timestamp: z.string(),
  user_id: z.string().optional(),
  user_input: z.string(),
  result: z.string().optional(),
  execution_time: z.number().optional(),
  model: z.string().optional(),
  agent_count: z.number().optional(),
  sync_version: z.number(),
  last_synced_at: z.string(),
  device_id: z.string().optional(),
  is_deleted: z.boolean(),
  is_archived: z.boolean().optional(),
  content_truncated: z.boolean().optional(),
  updated_at: z.string(),
});

export const MessageSyncPayloadSchema = z.object({
  message_id: z.string(),
  conversation_id: z.number(),
  conversation_local_id: z.string().optional(),
  role: z.string(),
  content: z.string(),
  is_streaming: z.boolean(),
  is_agent_status: z.boolean(),
  elapsed_seconds: z.number().optional(),
  created_at: z.string(),
  error: z.string().optional(),
  sources: z.unknown().optional(),
  tool_events: z.unknown().optional(),
  agent_statuses: z.unknown().optional(),
  trace: z.unknown().optional(),
  sync_version: z.number(),
  last_synced_at: z.string(),
  device_id: z.string().optional(),
  is_deleted: z.boolean(),
  content_truncated: z.boolean().optional(),
  updated_at: z.string(),
});

export const DeletionRecordSchema = z.object({
  type: z.enum(['conversation', 'message']),
  id: z.string(),
  deleted_at: z.string(),
});

export const SyncPullResponseSchema = z.object({
  conversations: z.array(ConversationSyncPayloadSchema),
  messages: z.array(MessageSyncPayloadSchema),
  deletions: z.array(DeletionRecordSchema),
  latest_version: z.number(),
  has_more: z.boolean().optional(),
  state_hash: z.string().optional(),
});

export const ConflictRecordSchema = z.object({
  type: z.enum(['conversation', 'message']),
  id: z.string(),
  reason: z.string(),
  server_version: z.number(),
  client_version: z.number(),
});

export const SyncPushResponseSchema = z.object({
  accepted: z.array(z.string()),
  conflicts: z.array(ConflictRecordSchema),
  new_version: z.number(),
  conversation_id_mappings: z.record(z.string(), z.number()),
});

export const SyncStatusResponseSchema = z.object({
  last_synced_at: z.string().optional().default(''),
  sync_version: z.number(),
  pending_changes: z.number(),
});

export const TokenResponseSchema = z.object({
  token: z.string().optional(),
  expires_in: z.number().positive().optional(),
});

export const ErrorStatusSchema = z.object({
  status: z.number().optional(),
});
