CREATE TABLE `auth_sessions` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `access_token` text NOT NULL,
    `expires_at` integer NOT NULL,
    `user_id` text NOT NULL,
    `email` text NOT NULL,
    `plan` text DEFAULT 'free' NOT NULL,
    `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversations` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `conversation_id` text NOT NULL,
    `user_id` text DEFAULT 'local' NOT NULL,
    `title` text NOT NULL,
    `status` text DEFAULT 'pending' NOT NULL,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `last_message_preview` text,
    `sync_version` integer DEFAULT 0 NOT NULL,
    `last_synced_at` integer DEFAULT 0 NOT NULL,
    `device_id` text,
    `is_deleted` integer DEFAULT false NOT NULL,
    `is_archived` integer DEFAULT false NOT NULL,
    `error` text
);
--> statement-breakpoint
CREATE INDEX `conversations_last_synced_at_idx` ON `conversations` (`last_synced_at`);--> statement-breakpoint
CREATE INDEX `conversations_sync_version_idx` ON `conversations` (`sync_version`);--> statement-breakpoint
CREATE INDEX `conversations_updated_at_idx` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `conversations_user_id_idx` ON `conversations` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversations_conversation_id_idx` ON `conversations` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_conversation_id_key` ON `conversations` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `messages` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `message_id` text NOT NULL,
    `conversation_id` text NOT NULL,
    `role` text NOT NULL,
    `content` text NOT NULL,
    `is_streaming` integer DEFAULT false NOT NULL,
    `is_agent_status` integer DEFAULT false NOT NULL,
    `elapsed_seconds` real,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `error` text,
    `sources` text,
    `tool_events` text,
    `agent_statuses` text,
    `metadata` text,
    `sync_version` integer DEFAULT 0 NOT NULL,
    `last_synced_at` integer DEFAULT 0 NOT NULL,
    `device_id` text,
    `is_deleted` integer DEFAULT false NOT NULL,
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`conversation_id`) ON UPDATE CASCADE ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `messages_sync_version_idx` ON `messages` (`sync_version`);--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `messages_message_id_idx` ON `messages` (`message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_id_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_message_id_key` ON `messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `metadata` (
    `key` text PRIMARY KEY NOT NULL,
    `value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_changes` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `type` text NOT NULL,
    `entity_id` text NOT NULL,
    `operation` text NOT NULL,
    `data` text NOT NULL,
    `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_changes_created_at_idx` ON `pending_changes` (`created_at`);--> statement-breakpoint
CREATE TABLE `pending_prompts` (
    `id` text PRIMARY KEY NOT NULL,
    `prompt` text NOT NULL,
    `conversation_id` text,
    `created_at` integer NOT NULL,
    `retry_count` integer DEFAULT 0 NOT NULL,
    `last_error` text,
    `model_id` text,
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`conversation_id`) ON UPDATE CASCADE ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `pending_prompts_created_at_idx` ON `pending_prompts` (`created_at`);--> statement-breakpoint
CREATE TABLE `prompt_queue` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `conversation_id` text NOT NULL,
    `prompt` text NOT NULL,
    `status` text NOT NULL,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `model_id` text,
    `attachment_ids` text,
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`conversation_id`) ON UPDATE CASCADE ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `prompt_queue_created_at_idx` ON `prompt_queue` (`created_at`);--> statement-breakpoint
CREATE INDEX `prompt_queue_status_idx` ON `prompt_queue` (`status`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
    `id` integer NOT NULL,
    `email` text PRIMARY KEY NOT NULL,
    `full_name` text,
    `avatar_url` text,
    `plan` text DEFAULT 'free' NOT NULL,
    `subscription_status` text,
    `current_period_end` text,
    `message_count` integer DEFAULT 0 NOT NULL,
    `last_message_timestamp` text,
    `data` text NOT NULL,
    `updated_at` integer NOT NULL
);
