import type * as SQLite from 'expo-sqlite';

import { mobileLogger } from '../logger';

export function createTablesFallback(rawDb: SQLite.SQLiteDatabase): void {
    mobileLogger.info('[MigrationRunner] Creating tables directly (fallback)');
    rawDb.execSync(`
    CREATE TABLE IF NOT EXISTS conversations (
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
    );
    CREATE TABLE IF NOT EXISTS messages (
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
    );
    CREATE TABLE IF NOT EXISTS prompt_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      conversation_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model_id TEXT,
      attachment_ids TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id) ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pending_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_prompts (
      id TEXT PRIMARY KEY NOT NULL,
      prompt TEXT NOT NULL,
      conversation_id TEXT,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0 NOT NULL,
      last_error TEXT,
      model_id TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations (conversation_id) ON UPDATE CASCADE ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      access_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      plan TEXT DEFAULT 'free' NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
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
    );
    CREATE INDEX IF NOT EXISTS conversations_last_synced_at_idx ON conversations (last_synced_at);
    CREATE INDEX IF NOT EXISTS conversations_sync_version_idx ON conversations (sync_version);
    CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations (updated_at);
    CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations (user_id);
    CREATE INDEX IF NOT EXISTS conversations_conversation_id_idx ON conversations (conversation_id);
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_conversation_id_key ON conversations (conversation_id);
    CREATE INDEX IF NOT EXISTS messages_sync_version_idx ON messages (sync_version);
    CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at);
    CREATE INDEX IF NOT EXISTS messages_message_id_idx ON messages (message_id);
    CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages (conversation_id);
    CREATE UNIQUE INDEX IF NOT EXISTS messages_message_id_key ON messages (message_id);
    CREATE INDEX IF NOT EXISTS pending_changes_created_at_idx ON pending_changes (created_at);
    CREATE INDEX IF NOT EXISTS pending_prompts_created_at_idx ON pending_prompts (created_at);
    CREATE INDEX IF NOT EXISTS prompt_queue_created_at_idx ON prompt_queue (created_at);
    CREATE INDEX IF NOT EXISTS prompt_queue_status_idx ON prompt_queue (status);
  `);
}
