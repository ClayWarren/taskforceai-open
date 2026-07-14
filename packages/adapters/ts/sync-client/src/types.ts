/**
 * Shared Sync Types - Used by both client and server
 *
 * These types define the contracts for bidirectional synchronization
 */

// ============================================================================
// Broadcast Events (SSE)
// ============================================================================

export type BroadcastEvent =
  | { type: 'connected'; connectionId: string }
  | { type: 'conversation:created'; userId: string; conversationId: number }
  | { type: 'conversation:updated'; userId: string; conversationId: number }
  | { type: 'conversation:deleted'; userId: string; conversationId: number }
  | { type: 'message:created'; userId: string; conversationId: number; messageId: string }
  | { type: 'message:updated'; userId: string; conversationId: number; messageId: string }
  | { type: 'message:deleted'; userId: string; messageId: string }
  | { type: 'sync:required'; userId?: string };

export type UnauthorizedSource = 'pull' | 'push' | 'status' | 'realtime-token' | 'realtime-poll';

// ============================================================================
// Sync Payloads
// ============================================================================

export interface ConversationSyncPayload {
  id?: number;
  local_id?: string; // For new conversations created offline
  timestamp: string;
  user_id?: string;
  user_input: string;
  result?: string;
  project_id?: number | null;
  execution_time?: number;
  model?: string;
  agent_count?: number;
  sync_version: number;
  vector_clock?: string;
  last_synced_at: string;
  device_id?: string;
  is_deleted: boolean;
  is_archived?: boolean;
  content_truncated?: boolean;
  updated_at: string;
}

export interface MessageSyncPayload {
  message_id: string;
  conversation_id: number;
  conversation_local_id?: string; // For messages referencing local conversations
  role: string;
  content: string;
  is_streaming: boolean;
  is_agent_status: boolean;
  elapsed_seconds?: number;
  created_at: string;
  error?: string;
  sources?: unknown;
  tool_events?: unknown;
  agent_statuses?: unknown;
  trace?: unknown;
  sync_version: number;
  vector_clock?: string;
  last_synced_at: string;
  device_id?: string;
  is_deleted: boolean;
  content_truncated?: boolean;
  updated_at: string;
}

export interface DeletionRecord {
  type: 'conversation' | 'message';
  id: string;
  deleted_at: string;
}

// ============================================================================
// Sync Requests & Responses
// ============================================================================

export interface SyncPullRequest {
  last_sync_version: number;
  device_id: string;
  limit?: number;
}

export interface SyncPullResponse {
  conversations: ConversationSyncPayload[];
  messages: MessageSyncPayload[];
  deletions: DeletionRecord[];
  latest_version: number;
  has_more?: boolean;
  state_hash?: string;
}

export interface SyncPushRequest {
  conversations: ConversationSyncPayload[];
  messages: MessageSyncPayload[];
  deletions: DeletionRecord[];
  device_id: string;
}

export interface SyncPushResponse {
  accepted: string[];
  conflicts: ConflictRecord[];
  new_version: number;
  conversation_id_mappings: { [localId: string]: number }; // Maps local IDs to server IDs
}

export interface ConflictRecord {
  type: 'conversation' | 'message';
  id: string;
  reason: string;
  server_version: number;
  client_version: number;
}
