use std::time::Duration;

use rusqlite::Connection;

use super::{SqliteRunStore, StoreResult};

impl SqliteRunStore {
    pub(super) fn open(&self) -> StoreResult<Connection> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        } // coverage:ignore-line

        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "pragma foreign_keys = on;
                 pragma journal_mode = wal;
                 pragma synchronous = normal;",
        )?;
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

fn initialize_schema(connection: &Connection) -> StoreResult<()> {
    connection.execute_batch(
            "create table if not exists runs (
                    id text primary key,
                    prompt text not null,
                    model_id text,
                    reasoning_effort text,
                    project_id integer,
                    status text not null,
                    output text,
                    error text,
                    created_at integer not null,
                    updated_at integer not null,
                    tool_events text,
                    sources text,
                    agent_statuses text,
                    pending_approval text
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
                    project_id integer,
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
                    reasoning_effort text,
                    attachment_ids text
                );

                create table if not exists app_threads (
                    id text primary key,
                    title text not null,
                    objective text not null,
                    state text not null,
                    archived integer not null,
                    source text not null,
                    task_mode text not null,
                    parent_thread_id text,
                    created_at integer not null,
                    updated_at integer not null
                );
                create index if not exists app_threads_updated_at_idx
                    on app_threads(updated_at desc, id desc);

                create table if not exists app_turns (
                    id text primary key,
                    thread_id text not null,
                    run_id text not null,
                    status text not null,
                    position integer not null,
                    created_at integer not null,
                    updated_at integer not null,
                    foreign key(thread_id) references app_threads(id) on delete cascade
                );
                create index if not exists app_turns_thread_position_idx
                    on app_turns(thread_id, position desc);

                create table if not exists app_thread_items (
                    id text primary key,
                    thread_id text not null,
                    turn_id text not null,
                    item_type text not null,
                    status text not null,
                    content text not null,
                    position integer not null,
                    created_at integer not null,
                    updated_at integer not null,
                    foreign key(thread_id) references app_threads(id) on delete cascade,
                    foreign key(turn_id) references app_turns(id) on delete cascade
                );
                create index if not exists app_thread_items_turn_position_idx
                    on app_thread_items(turn_id, position desc);
                create index if not exists app_thread_items_thread_created_idx
                    on app_thread_items(thread_id, created_at desc, id desc);",
        )?;
    migrate_existing_tables(connection)
}

fn migrate_existing_tables(connection: &Connection) -> StoreResult<()> {
    for (table, column, alter_sql) in [
        (
            "runs",
            "tool_events",
            "alter table runs add column tool_events text",
        ),
        (
            "runs",
            "sources",
            "alter table runs add column sources text",
        ),
        (
            "runs",
            "agent_statuses",
            "alter table runs add column agent_statuses text",
        ),
        (
            "runs",
            "pending_approval",
            "alter table runs add column pending_approval text",
        ),
        (
            "pending_prompts",
            "reasoning_effort",
            "alter table pending_prompts add column reasoning_effort text",
        ),
        (
            "pending_prompts",
            "project_id",
            "alter table pending_prompts add column project_id integer",
        ),
        (
            "pending_prompts",
            "status",
            "alter table pending_prompts add column status text not null default 'queued'",
        ),
        (
            "pending_prompts",
            "updated_at",
            "alter table pending_prompts add column updated_at integer not null default 0",
        ),
        (
            "prompt_queue",
            "dispatch_timing",
            "alter table prompt_queue add column dispatch_timing text not null default 'immediate'",
        ),
        (
            "prompt_queue",
            "reasoning_effort",
            "alter table prompt_queue add column reasoning_effort text",
        ),
        (
            "conversations",
            "project_id",
            "alter table conversations add column project_id integer",
        ),
        (
            "conversations",
            "sync_version",
            "alter table conversations add column sync_version integer not null default 0",
        ),
        (
            "conversations",
            "last_synced_at",
            "alter table conversations add column last_synced_at integer not null default 0",
        ),
        (
            "conversations",
            "device_id",
            "alter table conversations add column device_id text",
        ),
        (
            "conversations",
            "is_deleted",
            "alter table conversations add column is_deleted integer not null default 0",
        ),
        (
            "conversations",
            "is_archived",
            "alter table conversations add column is_archived integer not null default 0",
        ),
        (
            "messages",
            "is_streaming",
            "alter table messages add column is_streaming integer not null default 0",
        ),
        (
            "messages",
            "is_agent_status",
            "alter table messages add column is_agent_status integer not null default 0",
        ),
        (
            "messages",
            "is_local_command_output",
            "alter table messages add column is_local_command_output integer not null default 0",
        ),
        (
            "messages",
            "elapsed_seconds",
            "alter table messages add column elapsed_seconds real",
        ),
        (
            "messages",
            "error",
            "alter table messages add column error text",
        ),
        (
            "messages",
            "sources",
            "alter table messages add column sources text",
        ),
        (
            "messages",
            "tool_events",
            "alter table messages add column tool_events text",
        ),
        (
            "messages",
            "agent_statuses",
            "alter table messages add column agent_statuses text",
        ),
        (
            "messages",
            "trace_id",
            "alter table messages add column trace_id text",
        ),
        (
            "messages",
            "sync_version",
            "alter table messages add column sync_version integer not null default 0",
        ),
        (
            "messages",
            "last_synced_at",
            "alter table messages add column last_synced_at integer not null default 0",
        ),
        (
            "messages",
            "device_id",
            "alter table messages add column device_id text",
        ),
        (
            "messages",
            "is_deleted",
            "alter table messages add column is_deleted integer not null default 0",
        ),
    ] {
        ensure_column(connection, table, column, alter_sql)?;
    }
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> StoreResult<()> {
    let mut statement = connection.prepare(&format!("pragma table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|existing| existing == column) {
        connection.execute(alter_sql, [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_parent_directories_and_initializes_schema_once() {
        let base =
            std::env::temp_dir().join(format!("taskforceai-schema-open-{}", std::process::id()));
        let path = base.join("nested").join("store.sqlite");
        let _ = std::fs::remove_dir_all(&base);
        let store = SqliteRunStore::new(path.clone());

        let connection = store.open().expect("store should open");
        assert!(path.exists());
        assert!(has_column(&connection, "prompt_queue", "attachment_ids"));
        assert!(has_column(&connection, "prompt_queue", "reasoning_effort"));
        drop(connection);

        let second = store.open().expect("store should reopen without migrating");
        assert!(has_column(&second, "messages", "is_deleted"));
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn initialize_schema_migrates_legacy_tables() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "create table pending_prompts (
                    id text primary key,
                    prompt text not null,
                    model_id text,
                    retry_count integer not null default 0,
                    last_error text,
                    created_at integer not null
                );
                create table runs (
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
                create table prompt_queue (
                    id integer primary key autoincrement,
                    conversation_id text not null,
                    prompt text not null,
                    status text not null,
                    created_at integer not null,
                    updated_at integer not null,
                    model_id text,
                    attachment_ids text
                );
                create table conversations (
                    id integer primary key autoincrement,
                    conversation_id text not null unique,
                    user_id text not null default 'local',
                    title text not null,
                    status text not null default 'pending',
                    created_at integer not null,
                    updated_at integer not null,
                    last_message_preview text,
                    error text
                );
                create table messages (
                    id integer primary key autoincrement,
                    message_id text not null unique,
                    conversation_id text not null,
                    role text not null,
                    content text not null,
                    created_at integer not null,
                    updated_at integer not null,
                    metadata text
                );",
            )
            .unwrap();

        initialize_schema(&connection).expect("legacy schema should migrate");

        for column in [
            "tool_events",
            "sources",
            "agent_statuses",
            "pending_approval",
        ] {
            assert!(has_column(&connection, "runs", column));
        }

        for column in ["project_id", "reasoning_effort", "status", "updated_at"] {
            assert!(has_column(&connection, "pending_prompts", column));
        }
        for column in ["dispatch_timing", "reasoning_effort"] {
            assert!(has_column(&connection, "prompt_queue", column));
        }
        for column in [
            "sync_version",
            "last_synced_at",
            "device_id",
            "is_deleted",
            "is_archived",
            "project_id",
        ] {
            assert!(has_column(&connection, "conversations", column));
        }
        for column in [
            "is_streaming",
            "is_agent_status",
            "is_local_command_output",
            "elapsed_seconds",
            "error",
            "sources",
            "tool_events",
            "agent_statuses",
            "trace_id",
            "sync_version",
            "last_synced_at",
            "device_id",
            "is_deleted",
        ] {
            assert!(has_column(&connection, "messages", column));
        }
    }

    fn has_column(connection: &Connection, table: &str, column: &str) -> bool {
        let mut statement = connection
            .prepare(&format!("pragma table_info({table})"))
            .unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        columns.iter().any(|existing| existing == column)
    }
}
