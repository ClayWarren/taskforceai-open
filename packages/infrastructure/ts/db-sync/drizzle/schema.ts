import { sqliteTable, index, uniqueIndex, integer, text, real } from 'drizzle-orm/sqlite-core';
import { InferSelectModel } from 'drizzle-orm';

export const conversations = sqliteTable(
  'conversations',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id').default('local').notNull(),
    title: text().notNull(),
    status: text().default('pending').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastMessagePreview: text('last_message_preview'),
    projectId: integer('project_id'),
    syncVersion: integer('sync_version').default(0).notNull(),
    lastSyncedAt: integer('last_synced_at').default(0).notNull(),
    deviceId: text('device_id'),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).default(false).notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false).notNull(),
    error: text(),
  },
  (table) => [
    index('conversations_last_synced_at_idx').on(table.lastSyncedAt),
    index('conversations_sync_version_idx').on(table.syncVersion),
    index('conversations_updated_at_idx').on(table.updatedAt),
    index('conversations_user_id_idx').on(table.userId),
    uniqueIndex('conversations_conversation_id_key').on(table.conversationId),
  ]
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.conversationId, { onDelete: 'cascade', onUpdate: 'cascade' }),
    role: text().notNull(),
    content: text().notNull(),
    isStreaming: integer('is_streaming', { mode: 'boolean' }).default(false).notNull(),
    isAgentStatus: integer('is_agent_status', { mode: 'boolean' }).default(false).notNull(),
    elapsedSeconds: real('elapsed_seconds'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    error: text(),
    sources: text('sources'),
    toolEvents: text('tool_events'),
    agentStatuses: text('agent_statuses'),
    metadata: text('metadata'),
    syncVersion: integer('sync_version').default(0).notNull(),
    lastSyncedAt: integer('last_synced_at').default(0).notNull(),
    deviceId: text('device_id'),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => [
    index('messages_sync_version_idx').on(table.syncVersion),
    index('messages_created_at_idx').on(table.createdAt),
    index('messages_conversation_id_idx').on(table.conversationId),
    uniqueIndex('messages_message_id_key').on(table.messageId),
  ]
);

export const pendingChanges = sqliteTable(
  'pending_changes',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    type: text().notNull(),
    entityId: text('entity_id').notNull(),
    operation: text().notNull(),
    data: text('data').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('pending_changes_created_at_idx').on(table.createdAt)]
);

export const metadata = sqliteTable('metadata', {
  key: text().primaryKey().notNull(),
  value: text().notNull(),
});

export const pendingPrompts = sqliteTable(
  'pending_prompts',
  {
    id: text().primaryKey().notNull(),
    prompt: text().notNull(),
    conversationId: text('conversation_id').references(() => conversations.conversationId, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: integer('created_at').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    lastError: text('last_error'),
    modelId: text('model_id'),
  },
  (table) => [index('pending_prompts_created_at_idx').on(table.createdAt)]
);

export const promptQueue = sqliteTable(
  'prompt_queue',
  {
    id: integer().primaryKey({ autoIncrement: true }).notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.conversationId, { onDelete: 'cascade', onUpdate: 'cascade' }),
    prompt: text().notNull(),
    status: text().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    modelId: text('model_id'),
    attachmentIds: text('attachment_ids'),
  },
  (table) => [
    index('prompt_queue_created_at_idx').on(table.createdAt),
    index('prompt_queue_status_idx').on(table.status),
  ]
);

export const authSessions = sqliteTable('auth_sessions', {
  id: integer().primaryKey({ autoIncrement: true }).notNull(),
  accessToken: text('access_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
  userId: text('user_id').notNull(),
  email: text().notNull(),
  plan: text().default('free').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const userProfiles = sqliteTable('user_profiles', {
  id: integer().notNull(),
  email: text().primaryKey().notNull(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  plan: text().default('free').notNull(),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: text('current_period_end'),
  messageCount: integer('message_count').default(0).notNull(),
  lastMessageTimestamp: text('last_message_timestamp'),
  data: text().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type ConversationRow = InferSelectModel<typeof conversations>;
export type MessageRow = InferSelectModel<typeof messages>;
export type PendingChangeRow = InferSelectModel<typeof pendingChanges>;
export type PromptQueueRow = InferSelectModel<typeof promptQueue>;
export type AuthSessionRow = InferSelectModel<typeof authSessions>;
export type UserProfileRow = InferSelectModel<typeof userProfiles>;

export const mobileSchema = {
  conversations,
  messages,
  pendingChanges,
  metadata,
  pendingPrompts,
  promptQueue,
  authSessions,
  userProfiles,
};

export type MobileSchema = typeof mobileSchema;
