use std::time::Duration;

use rusqlite::Connection;

use super::{storage_error, SqliteRunStore};
use crate::runtime::RuntimeError;

impl SqliteRunStore {
    pub(super) fn open(&self) -> Result<Connection, RuntimeError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }

        let connection = Connection::open(&self.path).map_err(storage_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(storage_error)?;
        connection
            .execute_batch(
                "pragma journal_mode = wal;
                 pragma synchronous = normal;",
            )
            .map_err(storage_error)?;
        {
            let mut initialized = self
                .schema_initialized
                .lock()
                .expect("sqlite schema initialization lock should not be poisoned");
            if !*initialized {
                initialize_schema(&connection)?;
                *initialized = true;
            }
        }

        Ok(connection)
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), RuntimeError> {
    connection
        .execute_batch(
            "create table if not exists runs (
                    id text primary key,
                    prompt text not null,
                    model_id text,
                    project_id integer,
                    status text not null,
                    output text,
                    error text,
                    created_at integer not null,
                    updated_at integer not null
                );
                create index if not exists runs_updated_at_idx on runs(updated_at desc);

                create table if not exists conversations (
                    id integer primary key autoincrement,
                    conversation_id text not null unique,
                    user_id text not null default 'local',
                    title text not null,
                    status text not null default 'pending',
                    created_at integer not null,
                    updated_at integer not null,
                    last_message_preview text,
                    sync_version integer not null default 0,
                    last_synced_at integer not null default 0,
                    device_id text,
                    is_deleted integer not null default 0,
                    is_archived integer not null default 0,
                    error text
                );
                create index if not exists conversations_updated_at_idx on conversations(updated_at desc);

                create table if not exists messages (
                    id integer primary key autoincrement,
                    message_id text not null unique,
                    conversation_id text not null,
                    role text not null,
                    content text not null,
                    is_streaming integer not null default 0,
                    is_agent_status integer not null default 0,
                    is_local_command_output integer not null default 0,
                    elapsed_seconds real,
                    created_at integer not null,
                    updated_at integer not null,
                    error text,
                    sources text,
                    tool_events text,
                    agent_statuses text,
                    metadata text,
                    sync_version integer not null default 0,
                    last_synced_at integer not null default 0,
                    device_id text,
                    is_deleted integer not null default 0,
                    foreign key(conversation_id) references conversations(conversation_id) on delete cascade
                );
                create index if not exists messages_conversation_id_idx on messages(conversation_id);
                create index if not exists messages_created_at_idx on messages(created_at);

                create table if not exists metadata (
                    key text primary key,
                    value text not null
                );

                create table if not exists pending_prompts (
                    id text primary key,
                    prompt text not null,
                    model_id text,
                    project_id integer,
                    status text not null,
                    retry_count integer not null default 0,
                    last_error text,
                    created_at integer not null,
                    updated_at integer not null
                );

                create table if not exists pending_changes (
                    id integer primary key autoincrement,
                    type text not null,
                    entity_id text not null,
                    operation text not null,
                    data text not null,
                    created_at integer not null
                );

                create table if not exists prompt_queue (
                    id integer primary key autoincrement,
                    conversation_id text not null,
                    prompt text not null,
                    status text not null,
                    dispatch_timing text not null default 'immediate',
                    created_at integer not null,
                    updated_at integer not null,
                    model_id text,
                    attachment_ids text
                );",
        )
        .map_err(storage_error)?;
    migrate_existing_tables(connection)
}

fn migrate_existing_tables(connection: &Connection) -> Result<(), RuntimeError> {
    ensure_column(
        connection,
        "pending_prompts",
        "project_id",
        "alter table pending_prompts add column project_id integer",
    )?;
    ensure_column(
        connection,
        "pending_prompts",
        "status",
        "alter table pending_prompts add column status text not null default 'queued'",
    )?;
    ensure_column(
        connection,
        "pending_prompts",
        "updated_at",
        "alter table pending_prompts add column updated_at integer not null default 0",
    )?;
    ensure_column(
        connection,
        "prompt_queue",
        "dispatch_timing",
        "alter table prompt_queue add column dispatch_timing text not null default 'immediate'",
    )?;
    ensure_column(
        connection,
        "conversations",
        "sync_version",
        "alter table conversations add column sync_version integer not null default 0",
    )?;
    ensure_column(
        connection,
        "conversations",
        "last_synced_at",
        "alter table conversations add column last_synced_at integer not null default 0",
    )?;
    ensure_column(
        connection,
        "conversations",
        "device_id",
        "alter table conversations add column device_id text",
    )?;
    ensure_column(
        connection,
        "conversations",
        "is_deleted",
        "alter table conversations add column is_deleted integer not null default 0",
    )?;
    ensure_column(
        connection,
        "conversations",
        "is_archived",
        "alter table conversations add column is_archived integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "is_streaming",
        "alter table messages add column is_streaming integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "is_agent_status",
        "alter table messages add column is_agent_status integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "is_local_command_output",
        "alter table messages add column is_local_command_output integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "elapsed_seconds",
        "alter table messages add column elapsed_seconds real",
    )?;
    ensure_column(
        connection,
        "messages",
        "error",
        "alter table messages add column error text",
    )?;
    ensure_column(
        connection,
        "messages",
        "sources",
        "alter table messages add column sources text",
    )?;
    ensure_column(
        connection,
        "messages",
        "tool_events",
        "alter table messages add column tool_events text",
    )?;
    ensure_column(
        connection,
        "messages",
        "agent_statuses",
        "alter table messages add column agent_statuses text",
    )?;
    ensure_column(
        connection,
        "messages",
        "trace_id",
        "alter table messages add column trace_id text",
    )?;
    ensure_column(
        connection,
        "messages",
        "sync_version",
        "alter table messages add column sync_version integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "last_synced_at",
        "alter table messages add column last_synced_at integer not null default 0",
    )?;
    ensure_column(
        connection,
        "messages",
        "device_id",
        "alter table messages add column device_id text",
    )?;
    ensure_column(
        connection,
        "messages",
        "is_deleted",
        "alter table messages add column is_deleted integer not null default 0",
    )?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), RuntimeError> {
    let mut statement = connection
        .prepare(&format!("pragma table_info({table})"))
        .map_err(storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    if !columns.iter().any(|existing| existing == column) {
        connection.execute(alter_sql, []).map_err(storage_error)?;
    }
    Ok(())
}
