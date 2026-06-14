import { describe, expect, it } from 'bun:test';

import {
  ConversationSyncPayloadSchema,
  DeletionRecordSchema,
  MessageSyncPayloadSchema,
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  SyncStatusResponseSchema,
  TokenResponseSchema,
} from './validation';

const now = '2026-06-13T12:00:00.000Z';

const conversationPayload = {
  id: 42,
  local_id: 'local-42',
  timestamp: now,
  user_id: 'user-1',
  user_input: 'Coordinate the launch plan',
  result: 'Launch plan drafted',
  execution_time: 1.25,
  model: 'gpt-5',
  agent_count: 3,
  sync_version: 7,
  last_synced_at: now,
  device_id: 'device-1',
  is_deleted: false,
  is_archived: true,
  content_truncated: true,
  updated_at: now,
};

const messagePayload = {
  message_id: 'msg-42',
  conversation_id: 42,
  conversation_local_id: 'local-42',
  role: 'assistant',
  content: 'Ready.',
  is_streaming: false,
  is_agent_status: false,
  elapsed_seconds: 2,
  created_at: now,
  error: 'retryable',
  sources: [{ url: 'https://example.com/source' }],
  tool_events: [{ toolName: 'search', success: true }],
  agent_statuses: [{ status: 'complete' }],
  trace: { id: 'trace-42' },
  sync_version: 8,
  last_synced_at: now,
  device_id: 'device-1',
  is_deleted: false,
  content_truncated: true,
  updated_at: now,
};

describe('sync-client validation schemas', () => {
  it('preserves every supported conversation sync field', () => {
    expect(ConversationSyncPayloadSchema.parse(conversationPayload)).toEqual(conversationPayload);
  });

  it('preserves every supported message sync field', () => {
    expect(MessageSyncPayloadSchema.parse(messagePayload)).toEqual(messagePayload);
  });

  it('validates pull responses without stripping archive or trace metadata', () => {
    const response = {
      conversations: [conversationPayload],
      messages: [messagePayload],
      deletions: [{ type: 'message' as const, id: 'msg-removed', deleted_at: now }],
      latest_version: 9,
      has_more: true,
      state_hash: 'state-9',
    };

    expect(SyncPullResponseSchema.parse(response)).toEqual(response);
  });

  it('validates push response contracts', () => {
    expect(
      SyncPushResponseSchema.parse({
        accepted: ['conversation:local-42'],
        conflicts: [
          {
            type: 'conversation',
            id: 'local-42',
            reason: 'Version mismatch',
            server_version: 9,
            client_version: 7,
          },
        ],
        new_version: 10,
        conversation_id_mappings: { 'local-42': 42 },
      })
    ).toEqual({
      accepted: ['conversation:local-42'],
      conflicts: [
        {
          type: 'conversation',
          id: 'local-42',
          reason: 'Version mismatch',
          server_version: 9,
          client_version: 7,
        },
      ],
      new_version: 10,
      conversation_id_mappings: { 'local-42': 42 },
    });
  });

  it('applies status defaults and token ttl validation', () => {
    expect(SyncStatusResponseSchema.parse({ sync_version: 11, pending_changes: 2 })).toEqual({
      last_synced_at: '',
      sync_version: 11,
      pending_changes: 2,
    });
    expect(TokenResponseSchema.safeParse({ token: 'sync-token', expires_in: 60 }).success).toBe(
      true
    );
    expect(TokenResponseSchema.safeParse({ token: 'sync-token', expires_in: 0 }).success).toBe(
      false
    );
  });

  it('rejects deletion records with unsupported entity types', () => {
    expect(
      DeletionRecordSchema.safeParse({
        type: 'prompt',
        id: 'p1',
        deleted_at: now,
      }).success
    ).toBe(false);
  });
});
