export interface SchemaRebuildConfig {
  tableName: string;
  createSql: string;
  mappings: Record<string, string[]>;
}

export interface SchemaIndexConfig {
  name: string;
  table: string;
  column: string;
}

export const SCHEMA_REBUILD_CONFIGS: SchemaRebuildConfig[] = [
  {
    tableName: "conversations",
    createSql: `
    CREATE TABLE conversations_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      conversation_id TEXT NOT NULL,
      user_id TEXT DEFAULT 'local' NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_preview TEXT,
      sync_version INTEGER DEFAULT 0 NOT NULL,
      last_synced_at INTEGER DEFAULT 0 NOT NULL,
      device_id TEXT,
      is_deleted INTEGER DEFAULT 0 NOT NULL,
      is_archived INTEGER DEFAULT 0 NOT NULL,
      error TEXT
    )
  `,
    mappings: {
      conversation_id: ["conversationId", "conversation_id", "id"],
      user_id: ["userId", "user_id"],
      created_at: ["createdAt", "created_at"],
      updated_at: ["updatedAt", "updated_at"],
      last_message_preview: ["lastMessagePreview", "last_message_preview"],
      sync_version: ["syncVersion", "sync_version"],
      last_synced_at: ["lastSyncedAt", "last_synced_at"],
      device_id: ["deviceId", "device_id"],
      is_deleted: ["isDeleted", "is_deleted"],
      is_archived: ["isArchived", "is_archived"],
    },
  },
  {
    tableName: "messages",
    createSql: `
    CREATE TABLE messages_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      is_streaming INTEGER DEFAULT 0 NOT NULL,
      is_agent_status INTEGER DEFAULT 0 NOT NULL,
      elapsed_seconds REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      error TEXT,
      sources TEXT,
      tool_events TEXT,
      agent_statuses TEXT,
      metadata TEXT,
      sync_version INTEGER DEFAULT 0 NOT NULL,
      last_synced_at INTEGER DEFAULT 0 NOT NULL,
      device_id TEXT,
      is_deleted INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id) ON UPDATE CASCADE ON DELETE CASCADE
    )
  `,
    mappings: {
      message_id: ["messageId", "message_id", "id"],
      conversation_id: ["conversationId", "conversation_id"],
      is_streaming: ["isStreaming", "is_streaming"],
      is_agent_status: ["isAgentStatus", "is_agent_status"],
      elapsed_seconds: ["elapsedSeconds", "elapsed_seconds"],
      created_at: ["createdAt", "created_at"],
      updated_at: ["updatedAt", "updated_at"],
      tool_events: ["toolEvents", "tool_events"],
      agent_statuses: ["agentStatuses", "agent_statuses"],
      sync_version: ["syncVersion", "sync_version"],
      last_synced_at: ["lastSyncedAt", "last_synced_at"],
      device_id: ["deviceId", "device_id"],
      is_deleted: ["isDeleted", "is_deleted"],
    },
  },
  {
    tableName: "auth_sessions",
    createSql: `
    CREATE TABLE auth_sessions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      access_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      plan TEXT DEFAULT 'free' NOT NULL,
      created_at INTEGER NOT NULL
    )
  `,
    mappings: {
      access_token: ["accessToken", "access_token"],
      expires_at: ["expiresAt", "expires_at"],
      user_id: ["userId", "user_id"],
      created_at: ["createdAt", "created_at"],
    },
  },
  {
    tableName: "user_profiles",
    createSql: `
    CREATE TABLE user_profiles_new (
      id INTEGER NOT NULL,
      email TEXT PRIMARY KEY NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      plan TEXT DEFAULT 'free' NOT NULL,
      subscription_status TEXT,
      current_period_end TEXT,
      message_count INTEGER DEFAULT 0 NOT NULL,
      last_message_timestamp TEXT,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
    mappings: {
      id: ["id"],
      full_name: ["fullName", "full_name"],
      avatar_url: ["avatarUrl", "avatar_url"],
      subscription_status: ["subscriptionStatus", "subscription_status"],
      current_period_end: ["currentPeriodEnd", "current_period_end"],
      message_count: ["messageCount", "message_count"],
      last_message_timestamp: [
        "lastMessageTimestamp",
        "last_message_timestamp",
      ],
      updated_at: ["updatedAt", "updated_at"],
    },
  },
  {
    tableName: "prompt_queue",
    createSql: `
    CREATE TABLE prompt_queue_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      conversation_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model_id TEXT,
      attachment_ids TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id) ON UPDATE CASCADE ON DELETE CASCADE
    )
  `,
    mappings: {
      conversation_id: ["conversationId", "conversation_id"],
      created_at: ["createdAt", "created_at"],
      updated_at: ["updatedAt", "updated_at"],
      model_id: ["modelId", "model_id"],
      attachment_ids: ["attachmentIds", "attachment_ids"],
    },
  },
  {
    tableName: "pending_prompts",
    createSql: `
    CREATE TABLE pending_prompts_new (
      id TEXT PRIMARY KEY NOT NULL,
      prompt TEXT NOT NULL,
      conversation_id TEXT,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0 NOT NULL,
      last_error TEXT,
      model_id TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id) ON UPDATE CASCADE ON DELETE SET NULL
    )
  `,
    mappings: {
      conversation_id: ["conversationId", "conversation_id"],
      created_at: ["createdAt", "created_at"],
      retry_count: ["retryCount", "retry_count"],
      last_error: ["lastError", "last_error"],
      model_id: ["modelId", "model_id"],
    },
  },
  {
    tableName: "pending_changes",
    createSql: `
    CREATE TABLE pending_changes_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `,
    mappings: {
      entity_id: ["entityId", "entity_id"],
      created_at: ["createdAt", "created_at"],
    },
  },
];

export const SCHEMA_INDEX_CONFIGS: SchemaIndexConfig[] = [
  {
    name: "conversations_conversation_id_key",
    table: "conversations",
    column: "conversation_id",
  },
  {
    name: "messages_message_id_key",
    table: "messages",
    column: "message_id",
  },
];
