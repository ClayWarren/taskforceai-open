import { describe, expect, it } from 'bun:test';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';

import {
  authSessions,
  conversations,
  messages,
  metadata,
  mobileSchema,
  pendingChanges,
  pendingPrompts,
  promptQueue,
  userProfiles,
} from '@taskforceai/db-sync/drizzle/schema';

type SQLiteTable = Parameters<typeof getTableName>[0];

const tableEntries = [
  ['conversations', conversations, 'conversations'],
  ['messages', messages, 'messages'],
  ['pendingChanges', pendingChanges, 'pending_changes'],
  ['metadata', metadata, 'metadata'],
  ['pendingPrompts', pendingPrompts, 'pending_prompts'],
  ['promptQueue', promptQueue, 'prompt_queue'],
  ['authSessions', authSessions, 'auth_sessions'],
  ['userProfiles', userProfiles, 'user_profiles'],
] as const;

const columnNames = (table: SQLiteTable) => {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    Object.entries(columns).map(([propertyName, column]) => [propertyName, column.name])
  );
};

const indexDefinitions = (table: SQLiteTable) =>
  getTableConfig(table as never).indexes.map((index) => ({
    name: index.config.name,
    unique: index.config.unique,
    columns: index.config.columns.map((column) => column.name),
  }));

describe('mobile storage schema', () => {
  it('exports every Drizzle table through mobileSchema', () => {
    expect(Object.keys(mobileSchema)).toEqual(tableEntries.map(([schemaKey]) => schemaKey));

    for (const [schemaKey, table, sqliteName] of tableEntries) {
      expect(mobileSchema[schemaKey]).toBe(table);
      expect(getTableName(table)).toBe(sqliteName);
    }
  });

  it('keeps the local conversation and message column mappings stable', () => {
    expect(columnNames(conversations)).toMatchObject({
      conversationId: 'conversation_id',
      userId: 'user_id',
      lastMessagePreview: 'last_message_preview',
      syncVersion: 'sync_version',
      lastSyncedAt: 'last_synced_at',
      deviceId: 'device_id',
      isDeleted: 'is_deleted',
      isArchived: 'is_archived',
    });

    expect(columnNames(messages)).toMatchObject({
      messageId: 'message_id',
      conversationId: 'conversation_id',
      isStreaming: 'is_streaming',
      isAgentStatus: 'is_agent_status',
      elapsedSeconds: 'elapsed_seconds',
      toolEvents: 'tool_events',
      agentStatuses: 'agent_statuses',
      syncVersion: 'sync_version',
      lastSyncedAt: 'last_synced_at',
      deviceId: 'device_id',
      isDeleted: 'is_deleted',
    });
  });

  it('keeps queue, auth, and profile column mappings stable', () => {
    expect(columnNames(pendingChanges)).toMatchObject({
      entityId: 'entity_id',
      createdAt: 'created_at',
    });
    expect(columnNames(pendingPrompts)).toMatchObject({
      conversationId: 'conversation_id',
      createdAt: 'created_at',
      retryCount: 'retry_count',
      lastError: 'last_error',
      modelId: 'model_id',
    });
    expect(columnNames(promptQueue)).toMatchObject({
      conversationId: 'conversation_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      modelId: 'model_id',
      attachmentIds: 'attachment_ids',
    });
    expect(columnNames(authSessions)).toMatchObject({
      accessToken: 'access_token',
      expiresAt: 'expires_at',
      userId: 'user_id',
      createdAt: 'created_at',
    });
    expect(columnNames(userProfiles)).toMatchObject({
      fullName: 'full_name',
      avatarUrl: 'avatar_url',
      subscriptionStatus: 'subscription_status',
      currentPeriodEnd: 'current_period_end',
      messageCount: 'message_count',
      lastMessageTimestamp: 'last_message_timestamp',
      updatedAt: 'updated_at',
    });
    expect(columnNames(metadata)).toMatchObject({ key: 'key', value: 'value' });
  });

  it('defines the sync and lookup indexes used by repositories and migrations', () => {
    expect(indexDefinitions(conversations)).toEqual([
      { name: 'conversations_last_synced_at_idx', unique: false, columns: ['last_synced_at'] },
      { name: 'conversations_sync_version_idx', unique: false, columns: ['sync_version'] },
      { name: 'conversations_updated_at_idx', unique: false, columns: ['updated_at'] },
      { name: 'conversations_user_id_idx', unique: false, columns: ['user_id'] },
      { name: 'conversations_conversation_id_key', unique: true, columns: ['conversation_id'] },
    ]);

    expect(indexDefinitions(messages)).toEqual([
      { name: 'messages_sync_version_idx', unique: false, columns: ['sync_version'] },
      { name: 'messages_created_at_idx', unique: false, columns: ['created_at'] },
      { name: 'messages_conversation_id_idx', unique: false, columns: ['conversation_id'] },
      { name: 'messages_message_id_key', unique: true, columns: ['message_id'] },
    ]);

    expect(indexDefinitions(pendingChanges)).toEqual([
      { name: 'pending_changes_created_at_idx', unique: false, columns: ['created_at'] },
    ]);
    expect(indexDefinitions(pendingPrompts)).toEqual([
      { name: 'pending_prompts_created_at_idx', unique: false, columns: ['created_at'] },
    ]);
    expect(indexDefinitions(promptQueue)).toEqual([
      { name: 'prompt_queue_created_at_idx', unique: false, columns: ['created_at'] },
      { name: 'prompt_queue_status_idx', unique: false, columns: ['status'] },
    ]);
  });
});
